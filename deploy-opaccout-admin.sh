#!/usr/bin/env bash
# 使用方式：
# chmod +x ./deploy-opaccout-admin.sh
# bash ./deploy-opaccout-admin.sh

set -euo pipefail

if [[ -t 1 ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; B=$'\033[0;34m'; NC=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; NC=''
fi

info() { printf "${B}[INFO]${NC} %s\n" "$1"; }
warn() { printf "${Y}[WARN]${NC} %s\n" "$1"; }
error() { printf "${R}[ERROR]${NC} %s\n" "$1" >&2; }
ok() { printf "${G}[OK]${NC} %s\n" "$1"; }

APP_SLUG="opaccout-admin"
DEFAULT_REPO_URL="https://github.com/tztmr/opaccout_admin.git"
DEFAULT_BRANCH="main"
DEFAULT_INSTALL_DIR="/opt/opaccout_admin"
STATE_DIR="${HOME}/.${APP_SLUG}-deploy"
STATE_FILE="${STATE_DIR}/state.env"

PROJECT_DIR=""
REPO_URL=""
BRANCH=""
DOMAIN=""
EMAIL=""

trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

apt_update_fast() {
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update \
    -o Acquire::Languages=none \
    -o Acquire::Retries=3
}

apt_install_fast() {
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return $?
  fi
  if command_exists sudo; then
    sudo "$@"
    return $?
  fi
  return 1
}

ensure_sudo_session() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if ! command_exists sudo; then
    error "需要 root 或 sudo 权限"
    exit 1
  fi

  info "接下来需要 sudo 权限，系统可能会提示你输入密码"
  sudo -v
}

ensure_root_capability() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if ! command_exists sudo; then
    error "需要 root 或 sudo 权限"
    exit 1
  fi
  ensure_sudo_session
}

prompt_default() {
  local prompt="$1" default_value="${2:-}" answer=""
  if [[ -n "$default_value" ]]; then
    printf '%s [%s]: ' "$prompt" "$default_value" >&2
  else
    printf '%s: ' "$prompt" >&2
  fi
  read -r answer
  answer="$(trim "$answer")"
  [[ -z "$answer" ]] && answer="$default_value"
  printf '%s' "$answer"
}

ask_yes_no() {
  local prompt="$1" default_value="${2:-y}" answer="" hint="[Y/n]"
  [[ "$default_value" == "n" ]] && hint="[y/N]"
  while true; do
    printf '%s %s: ' "$prompt" "$hint" >&2
    read -r answer
    answer="$(trim "$answer")"
    [[ -z "$answer" ]] && answer="$default_value"
    answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) warn "请输入 y 或 n" ;;
    esac
  done
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  (( "$1" >= 1 && "$1" <= 65535 ))
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR" 2>/dev/null || true
}

save_state() {
  ensure_state_dir
  {
    printf 'PROJECT_DIR=%q\n' "$PROJECT_DIR"
    printf 'REPO_URL=%q\n' "$REPO_URL"
    printf 'BRANCH=%q\n' "$BRANCH"
    printf 'DOMAIN=%q\n' "${DOMAIN:-}"
    printf 'EMAIL=%q\n' "${EMAIL:-}"
  } > "$STATE_FILE"
  chmod 600 "$STATE_FILE" 2>/dev/null || true
}

load_state() {
  [[ -f "$STATE_FILE" ]] || return 1
  set +u
  source "$STATE_FILE"
  set -u
  [[ -n "${PROJECT_DIR:-}" && -n "${REPO_URL:-}" && -n "${BRANCH:-}" ]]
}

read_env_value() {
  local env_file="$1" key="$2"
  [[ -f "$env_file" ]] || return 0
  grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true
}

set_env_value() {
  local env_file="$1" key="$2" value="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  if [[ -f "$env_file" ]]; then
    grep -Ev "^${key}=" "$env_file" > "$tmp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
  install -m 0600 "$tmp_file" "$env_file"
  rm -f "$tmp_file"
}

random_alnum() {
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "${1:-32}" || true
}

random_base64_32() {
  openssl rand -base64 32 2>/dev/null || true
}

assert_project_layout() {
  [[ -f "${PROJECT_DIR}/docker-compose.yml" ]] || { error "项目目录缺少 docker-compose.yml: ${PROJECT_DIR}"; return 1; }
  [[ -f "${PROJECT_DIR}/.env.example" ]] || { error "项目目录缺少 .env.example: ${PROJECT_DIR}"; return 1; }
  [[ -f "${PROJECT_DIR}/apps/api/Dockerfile" ]] || { error "项目目录缺少 apps/api/Dockerfile: ${PROJECT_DIR}"; return 1; }
  [[ -f "${PROJECT_DIR}/apps/web/Dockerfile" ]] || { error "项目目录缺少 apps/web/Dockerfile: ${PROJECT_DIR}"; return 1; }
}

ensure_basic_packages() {
  if command_exists curl && command_exists git; then
    return 0
  fi

  ensure_root_capability
  info "检测到缺少 Git 或 curl，开始安装基础依赖"
  if command_exists apt-get; then
    info "正在执行 apt-get update（已关闭语言包索引，加快海外服务器速度）"
    apt_update_fast
    info "正在安装 ca-certificates curl git gnupg lsb-release"
    apt_install_fast ca-certificates curl git gnupg lsb-release
  elif command_exists dnf; then
    info "正在安装 ca-certificates curl git"
    run_root dnf install -y ca-certificates curl git
  elif command_exists yum; then
    info "正在安装 ca-certificates curl git"
    run_root yum install -y ca-certificates curl git
  else
    error "不支持的系统包管理器，请手动安装 curl 与 git"
    return 1
  fi

  ok "基础依赖已就绪"
}

install_docker_if_needed() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    return 0
  fi

  ensure_basic_packages
  ensure_root_capability

  info "检测到未安装 Docker Compose，开始自动安装 Docker"
  curl -fsSL https://get.docker.com | run_root sh

  if command_exists systemctl; then
    run_root systemctl enable --now docker
  fi

  if ! command_exists docker; then
    error "Docker 安装失败，请手动检查"
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    error "Docker Compose 插件不可用，请手动检查 Docker 安装"
    return 1
  fi

  ok "Docker 与 Docker Compose 安装完成"
}

ensure_docker_ready() {
  if command_exists systemctl; then
    run_root systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  run_root docker info >/dev/null 2>&1 || {
    error "当前无法访问 Docker daemon，请确认 docker 服务已启动，或当前用户已加入 docker 组"
    return 1
  }
}

install_nginx_if_needed() {
  if command_exists nginx; then
    return 0
  fi

  ensure_root_capability
  info "检测到未安装 Nginx，开始自动安装"
  if command_exists apt-get; then
    info "正在执行 apt-get update（已关闭语言包索引，加快海外服务器速度）"
    apt_update_fast
    info "正在安装 nginx"
    apt_install_fast nginx
  elif command_exists dnf; then
    info "正在安装 nginx"
    run_root dnf install -y nginx
  elif command_exists yum; then
    info "正在安装 nginx"
    run_root yum install -y nginx
  else
    error "不支持的系统包管理器，请手动安装 Nginx"
    return 1
  fi

  if command_exists systemctl; then
    run_root systemctl enable --now nginx
  fi
  ok "Nginx 安装完成"
}

install_certbot_if_needed() {
  if command_exists certbot; then
    return 0
  fi

  ensure_root_capability
  info "检测到未安装 certbot，开始自动安装"
  if command_exists apt-get; then
    info "正在执行 apt-get update（已关闭语言包索引，加快海外服务器速度）"
    apt_update_fast
    info "正在安装 certbot 和 python3-certbot-nginx"
    apt_install_fast certbot python3-certbot-nginx
  elif command_exists dnf; then
    info "正在安装 certbot"
    run_root dnf install -y certbot python3-certbot-nginx || run_root dnf install -y certbot-nginx
  elif command_exists yum; then
    info "正在安装 certbot"
    run_root yum install -y certbot python3-certbot-nginx || run_root yum install -y certbot-nginx
  else
    error "不支持的系统包管理器，请手动安装 certbot"
    return 1
  fi

  ok "certbot 安装完成"
}

allow_firewall_port() {
  local port="$1"
  if command_exists ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    run_root ufw allow "${port}/tcp" >/dev/null 2>&1 || true
  fi
  if command_exists firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
    run_root firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null 2>&1 || true
    run_root firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

sync_project_code() {
  local install_dir="$1" repo_url="$2" branch="$3"

  ensure_basic_packages

  if [[ -d "${install_dir}/.git" ]]; then
    info "检测到已有代码，开始拉取最新版本"
    git -C "$install_dir" fetch origin "$branch"
    git -C "$install_dir" checkout "$branch"
    git -C "$install_dir" pull --ff-only origin "$branch"
  else
    if [[ -d "$install_dir" ]] && [[ -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
      error "安装目录已存在且不是 Git 仓库：${install_dir}"
      error "请换一个空目录，或先清理该目录后重试"
      return 1
    fi

    ensure_root_capability
    run_root mkdir -p "$(dirname "$install_dir")"
    run_root mkdir -p "$install_dir"
    if [[ "$(id -u)" -ne 0 ]]; then
      run_root chown -R "$(id -u):$(id -g)" "$install_dir"
    fi

    info "开始克隆项目代码到 ${install_dir}"
    git clone --branch "$branch" "$repo_url" "$install_dir"
  fi

  PROJECT_DIR="$install_dir"
}

docker_compose() {
  (
    cd "$PROJECT_DIR"
    if docker info >/dev/null 2>&1; then
      docker compose "$@"
    else
      run_root docker compose "$@"
    fi
  )
}

check_domain_dns() {
  local domain="$1"
  [[ -z "$domain" ]] && return 1

  if command_exists getent && getent hosts "$domain" >/dev/null 2>&1; then
    return 0
  fi
  if command_exists dig && [[ -n "$(dig +short "$domain" | tr -d '[:space:]')" ]]; then
    return 0
  fi
  if command_exists host && host "$domain" >/dev/null 2>&1; then
    return 0
  fi

  error "域名 ${domain} 目前未解析到服务器 IP，请先完成 DNS 解析后再申请 HTTPS"
  return 1
}

wait_for_http_ready() {
  local web_port
  web_port="$(read_env_value "${PROJECT_DIR}/.env" "WEB_PORT")"
  web_port="${web_port:-8080}"

  local attempts=30
  local web_url="http://127.0.0.1:${web_port}/"
  local ready_url="http://127.0.0.1:${web_port}/api/health/ready"

  while (( attempts > 0 )); do
    if curl -fsS "$web_url" >/dev/null 2>&1 && curl -fsS "$ready_url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    attempts=$((attempts - 1))
  done

  error "服务启动后未能成功响应：${web_url}"
  docker_compose ps || true
  docker_compose logs --tail=120 api web || true
  return 1
}

configure_env() {
  local target_dir="${1:-$PROJECT_DIR}"
  [[ -z "$target_dir" ]] && { error "项目目录未确定，请先执行部署。"; return 1; }

  local env_file="${target_dir}/.env"
  local example_file="${target_dir}/.env.example"

  info "配置环境变量 (.env)"

  local current_session current_encrypt current_mongo_user current_mongo_pass current_mongo_db
  local current_douyin_api current_qq_api current_qq_app_id current_qq_timeout current_web_port current_tz current_cookie_secure

  current_session="$(read_env_value "$env_file" "SESSION_SECRET")"
  current_encrypt="$(read_env_value "$env_file" "FIELD_ENCRYPTION_KEY")"
  current_mongo_user="$(read_env_value "$env_file" "MONGO_ROOT_USERNAME")"
  current_mongo_pass="$(read_env_value "$env_file" "MONGO_ROOT_PASSWORD")"
  current_mongo_db="$(read_env_value "$env_file" "MONGO_DATABASE")"
  current_douyin_api="$(read_env_value "$env_file" "DOUYIN_CHECK_API_URL")"
  current_qq_api="$(read_env_value "$env_file" "QQ_OP_PROFILE_API_URL")"
  current_qq_app_id="$(read_env_value "$env_file" "QQ_OP_APP_ID")"
  current_qq_timeout="$(read_env_value "$env_file" "QQ_OP_PROFILE_TIMEOUT_MS")"
  current_web_port="$(read_env_value "$env_file" "WEB_PORT")"
  current_tz="$(read_env_value "$env_file" "TZ")"
  current_cookie_secure="$(read_env_value "$env_file" "COOKIE_SECURE")"

  [[ -z "$current_mongo_user" ]] && current_mongo_user="$(read_env_value "$example_file" "MONGO_ROOT_USERNAME")"
  [[ -z "$current_mongo_pass" ]] && current_mongo_pass="$(random_alnum 24)"
  [[ -z "$current_mongo_db" ]] && current_mongo_db="$(read_env_value "$example_file" "MONGO_DATABASE")"
  [[ -z "$current_session" ]] && current_session="$(random_alnum 48)"
  [[ -z "$current_encrypt" ]] && current_encrypt="$(random_base64_32)"
  [[ -z "$current_douyin_api" ]] && current_douyin_api="$(read_env_value "$example_file" "DOUYIN_CHECK_API_URL")"
  [[ -z "$current_qq_api" ]] && current_qq_api="$(read_env_value "$example_file" "QQ_OP_PROFILE_API_URL")"
  [[ -z "$current_qq_app_id" ]] && current_qq_app_id="$(read_env_value "$example_file" "QQ_OP_APP_ID")"
  [[ -z "$current_qq_timeout" ]] && current_qq_timeout="$(read_env_value "$example_file" "QQ_OP_PROFILE_TIMEOUT_MS")"
  [[ -z "$current_web_port" ]] && current_web_port="$(read_env_value "$example_file" "WEB_PORT")"
  [[ -z "$current_tz" ]] && current_tz="$(read_env_value "$example_file" "TZ")"
  [[ -z "$current_cookie_secure" ]] && current_cookie_secure="$(read_env_value "$example_file" "COOKIE_SECURE")"

  current_mongo_user="${current_mongo_user:-douyin_admin}"
  current_mongo_db="${current_mongo_db:-douyin_accounts}"
  current_douyin_api="${current_douyin_api:-https://unid.tztright.top/check}"
  current_qq_api="${current_qq_api:-https://graph.qq.com/user/get_simple_userinfo}"
  current_qq_app_id="${current_qq_app_id:-1105602870}"
  current_qq_timeout="${current_qq_timeout:-5000}"
  current_web_port="${current_web_port:-8080}"
  current_tz="${current_tz:-Asia/Shanghai}"
  current_cookie_secure="${current_cookie_secure:-false}"

  local new_mongo_user new_mongo_pass new_mongo_db new_session new_encrypt
  local new_douyin_api new_qq_api new_qq_app_id new_qq_timeout new_web_port new_tz new_cookie_secure

  new_mongo_user="$(prompt_default "MongoDB 超级用户名 (MONGO_ROOT_USERNAME)" "$current_mongo_user")"
  new_mongo_pass="$(prompt_default "MongoDB 超级密码 (MONGO_ROOT_PASSWORD)" "$current_mongo_pass")"
  new_mongo_db="$(prompt_default "MongoDB 数据库名 (MONGO_DATABASE)" "$current_mongo_db")"
  new_session="$(prompt_default "会话密钥 (SESSION_SECRET)" "$current_session")"
  new_encrypt="$(prompt_default "字段加密密钥 Base64 (FIELD_ENCRYPTION_KEY)" "$current_encrypt")"
  new_douyin_api="$(prompt_default "抖音检测接口 (DOUYIN_CHECK_API_URL)" "$current_douyin_api")"
  new_qq_api="$(prompt_default "QQ OP 查询接口 (QQ_OP_PROFILE_API_URL)" "$current_qq_api")"
  new_qq_app_id="$(prompt_default "QQ OP App ID (QQ_OP_APP_ID)" "$current_qq_app_id")"
  new_qq_timeout="$(prompt_default "QQ OP 超时毫秒 (QQ_OP_PROFILE_TIMEOUT_MS)" "$current_qq_timeout")"
  new_web_port="$(prompt_default "Web 暴露端口 (WEB_PORT)" "$current_web_port")"
  new_tz="$(prompt_default "时区 (TZ)" "$current_tz")"
  new_cookie_secure="$(prompt_default "HTTPS 安全 Cookie (COOKIE_SECURE)" "$current_cookie_secure")"

  [[ -n "$new_mongo_user" ]] || { error "MONGO_ROOT_USERNAME 不能为空"; return 1; }
  [[ -n "$new_mongo_pass" ]] || { error "MONGO_ROOT_PASSWORD 不能为空"; return 1; }
  [[ -n "$new_mongo_db" ]] || { error "MONGO_DATABASE 不能为空"; return 1; }
  [[ -n "$new_session" ]] || { error "SESSION_SECRET 不能为空"; return 1; }
  [[ -n "$new_encrypt" ]] || { error "FIELD_ENCRYPTION_KEY 不能为空"; return 1; }
  validate_port "$new_web_port" || { error "WEB_PORT 无效：$new_web_port"; return 1; }
  [[ "$new_cookie_secure" == "true" || "$new_cookie_secure" == "false" ]] || {
    error "COOKIE_SECURE 只能是 true 或 false"
    return 1
  }

  cat > "$env_file" <<EOF
# 管理员账号和密码在首次打开后台时注册，并保存在 MongoDB 中。

# 至少 32 个随机字符，用于签名登录会话。
SESSION_SECRET=${new_session}
SESSION_HOURS=12

# 32 字节随机值的 Base64。可用：openssl rand -base64 32
FIELD_ENCRYPTION_KEY=${new_encrypt}

# 请使用 URL 安全字符，避免在连接字符串中需要额外转义。
MONGO_ROOT_USERNAME=${new_mongo_user}
MONGO_ROOT_PASSWORD=${new_mongo_pass}
MONGO_DATABASE=${new_mongo_db}

DOUYIN_CHECK_API_URL=${new_douyin_api}
QQ_OP_PROFILE_API_URL=${new_qq_api}
QQ_OP_APP_ID=${new_qq_app_id}
QQ_OP_PROFILE_TIMEOUT_MS=${new_qq_timeout}
WEB_PORT=${new_web_port}
TZ=${new_tz}

# 本机 http://localhost 首次运行设为 false；接入 HTTPS 域名后必须改为 true。
COOKIE_SECURE=${new_cookie_secure}
EOF

  chmod 600 "$env_file" 2>/dev/null || true
  ok "环境变量已保存至 ${env_file}"
}

deploy_app() {
  local install_dir

  install_docker_if_needed
  ensure_docker_ready

  if load_state; then
    install_dir="${PROJECT_DIR:-$DEFAULT_INSTALL_DIR}"
    REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
    BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
  else
    install_dir="$DEFAULT_INSTALL_DIR"
    REPO_URL="$DEFAULT_REPO_URL"
    BRANCH="$DEFAULT_BRANCH"
  fi

  install_dir="$(prompt_default "项目安装目录" "$install_dir")"
  REPO_URL="$(prompt_default "Git 仓库地址" "$REPO_URL")"
  BRANCH="$(prompt_default "分支名" "$BRANCH")"

  [[ -n "$install_dir" ]] || { error "安装目录不能为空"; return 1; }
  [[ -n "$REPO_URL" ]] || { error "Git 仓库地址不能为空"; return 1; }
  [[ -n "$BRANCH" ]] || { error "分支名不能为空"; return 1; }

  sync_project_code "$install_dir" "$REPO_URL" "$BRANCH"
  assert_project_layout
  configure_env "$install_dir"

  info "校验 docker compose 配置"
  docker_compose config --quiet

  info "开始构建并启动容器"
  (
    cd "$PROJECT_DIR"
    if docker info >/dev/null 2>&1; then
      DOCKER_BUILDKIT=0 docker compose up -d --build
    else
      run_root env DOCKER_BUILDKIT=0 docker compose up -d --build
    fi
  )
  wait_for_http_ready
  save_state

  local web_port
  web_port="$(read_env_value "${PROJECT_DIR}/.env" "WEB_PORT")"
  web_port="${web_port:-8080}"

  ok "应用部署完成"
  echo "项目目录：${PROJECT_DIR}"
  echo "Git 仓库：${REPO_URL}"
  echo "分支：${BRANCH}"
  echo "访问地址：http://服务器IP:${web_port}"
  echo "首次打开后台时，请先在页面注册管理员账号。"
  echo "如需域名 HTTPS，可继续执行脚本菜单中的“接入域名 HTTPS”。"
}

restart_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  info "重启容器服务"
  docker_compose restart
  wait_for_http_ready
  ok "服务已重启"
}

rebuild_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  install_docker_if_needed
  ensure_docker_ready

  sync_project_code "$PROJECT_DIR" "$REPO_URL" "$BRANCH"
  assert_project_layout

  info "重新构建并部署容器"
  (
    cd "$PROJECT_DIR"
    if docker info >/dev/null 2>&1; then
      DOCKER_BUILDKIT=0 docker compose up -d --build
    else
      run_root env DOCKER_BUILDKIT=0 docker compose up -d --build
    fi
  )
  wait_for_http_ready
  save_state
  ok "代码已更新并重新部署"
}

status_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout

  local web_port
  web_port="$(read_env_value "${PROJECT_DIR}/.env" "WEB_PORT")"
  web_port="${web_port:-8080}"

  echo "项目目录：${PROJECT_DIR}"
  echo "Git 仓库：${REPO_URL}"
  echo "分支：${BRANCH}"
  echo "Web 端口：${web_port}"
  echo "域名：${DOMAIN:-未配置}"
  echo
  docker_compose ps
}

logs_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  local service="${1:-}"
  if [[ -n "$service" ]]; then
    docker_compose logs -f --tail=120 "$service"
  else
    docker_compose logs -f --tail=120 api web mongo
  fi
}

down_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  warn "将停止并删除容器，但会保留 MongoDB 数据卷。"
  if ask_yes_no "确认继续停止服务" "n"; then
    docker_compose down
    ok "服务已停止，数据卷仍保留"
  fi
}

get_mongo_credentials() {
  local env_file="${PROJECT_DIR}/.env"
  MONGO_USER="$(read_env_value "$env_file" "MONGO_ROOT_USERNAME")"
  MONGO_PASS="$(read_env_value "$env_file" "MONGO_ROOT_PASSWORD")"
  MONGO_DB="$(read_env_value "$env_file" "MONGO_DATABASE")"
}

list_admin_users_db() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  get_mongo_credentials

  info "管理员账号列表："
  docker_compose exec -T mongo mongosh --quiet \
    --host 127.0.0.1 \
    --username "$MONGO_USER" \
    --password "$MONGO_PASS" \
    --authenticationDatabase admin \
    "$MONGO_DB" \
    --eval 'db.admins.find({}, { username: 1, createdAt: 1, _id: 1 }).toArray().forEach(a => print(`ID: ${a._id} | 账号: ${a.username} | 创建时间: ${a.createdAt}`))' || {
      error "获取管理员列表失败，请检查 MongoDB 服务是否正常运行"
      return 1
    }
}

reset_admin_password() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  local new_password
  new_password="$(prompt_default "新的管理员密码" "")"
  [[ -n "$new_password" ]] || { error "新密码不能为空"; return 1; }

  info "正在生成密码 Hash..."
  local digest
  digest="$(docker_compose exec -T api node -e '
    const crypto = require("crypto");
    const util = require("util");
    const scrypt = util.promisify(crypto.scrypt);
    const password = process.argv[1];
    (async () => {
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      console.log(JSON.stringify({
        passwordSalt: salt.toString("base64"),
        passwordHash: hash.toString("base64")
      }));
    })();
  ' "$new_password")" || {
    error "密码 Hash 生成失败，请检查 api 容器是否运行"
    return 1
  }

  local salt hash
  salt="$(echo "$digest" | grep -o '"passwordSalt":"[^"]*' | cut -d'"' -f4)"
  hash="$(echo "$digest" | grep -o '"passwordHash":"[^"]*' | cut -d'"' -f4)"

  [[ -n "$salt" && -n "$hash" ]] || { error "密码 Hash 解析失败"; return 1; }

  get_mongo_credentials

  info "正在更新数据库..."
  local update_result
  update_result="$(docker_compose exec -T mongo mongosh --quiet \
    --host 127.0.0.1 \
    --username "$MONGO_USER" \
    --password "$MONGO_PASS" \
    --authenticationDatabase admin \
    "$MONGO_DB" \
    --eval "db.admins.updateOne({ _id: 'primary' }, { \$set: { passwordSalt: '${salt}', passwordHash: '${hash}', updatedAt: new Date() } })")" || {
      error "更新数据库失败"
      return 1
    }

  if echo "$update_result" | grep -q "matchedCount: 1"; then
    ok "管理员密码已重置"
  elif echo "$update_result" | grep -q "matchedCount: 0"; then
    warn "未找到管理员账号，可能系统还未初始化"
  else
    warn "操作完成，但返回了未知的状态：$update_result"
  fi
}

uninstall_app() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  warn "将停止并删除容器和镜像。如果不保留数据，MongoDB 数据卷也将被删除。"
  if ask_yes_no "确认继续卸载服务" "n"; then
    if ask_yes_no "是否同时删除数据库数据卷（删除后无法恢复！）" "n"; then
      docker_compose down -v --rmi all
      ok "服务及数据已完全删除"
    else
      docker_compose down --rmi all
      ok "服务已删除，MongoDB 数据卷已保留"
    fi
  fi
}

configure_env_command() {
  load_state || { error "请先执行 deploy"; return 1; }
  assert_project_layout
  configure_env "$PROJECT_DIR"

  if ask_yes_no "环境变量已更新，是否立即重新创建容器使其生效" "y"; then
    ensure_docker_ready
    docker_compose up -d --force-recreate
    wait_for_http_ready
    ok "新配置已生效"
  else
    warn "配置已保存，稍后请执行 restart 或 rebuild 使其生效"
  fi
}

nginx_conf_dir() {
  if [[ -d /etc/nginx/conf.d ]]; then
    printf '/etc/nginx/conf.d'
  else
    printf '/etc/nginx/sites-available'
  fi
}

enable_nginx_conf_if_needed() {
  local conf_file="$1"
  if [[ "$conf_file" == /etc/nginx/conf.d/* ]]; then
    run_root rm -f "/etc/nginx/sites-enabled/$(basename "$conf_file")" 2>/dev/null || true
    return 0
  fi
  if [[ -d /etc/nginx/sites-enabled ]]; then
    run_root ln -sf "$conf_file" "/etc/nginx/sites-enabled/$(basename "$conf_file")"
  fi
}

write_nginx_http_conf() {
  local conf_file="$1" domain="$2" web_port="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  cat > "$tmp_file" <<EOF
server {
    listen 80;
    server_name ${domain};

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

  run_root install -m 0644 "$tmp_file" "$conf_file"
  rm -f "$tmp_file"
}

setup_https() {
  load_state || { error "请先执行应用部署"; return 1; }
  assert_project_layout
  ensure_docker_ready

  install_nginx_if_needed
  install_certbot_if_needed

  local web_port
  web_port="$(read_env_value "${PROJECT_DIR}/.env" "WEB_PORT")"
  web_port="${web_port:-8080}"

  DOMAIN="$(prompt_default "绑定域名（如 admin.example.com）" "${DOMAIN:-}")"
  [[ -n "$DOMAIN" ]] || { error "域名不能为空"; return 1; }
  EMAIL="$(prompt_default "证书邮箱" "${EMAIL:-admin@${DOMAIN}}")"
  check_domain_dns "$DOMAIN"

  local conf_dir conf_file env_file
  conf_dir="$(nginx_conf_dir)"
  conf_file="${conf_dir}/${DOMAIN}.conf"
  env_file="${PROJECT_DIR}/.env"

  run_root mkdir -p "$conf_dir"
  write_nginx_http_conf "$conf_file" "$DOMAIN" "$web_port"
  enable_nginx_conf_if_needed "$conf_file"

  allow_firewall_port 80
  allow_firewall_port 443
  run_root nginx -t
  if command_exists systemctl; then
    run_root systemctl reload nginx
  else
    run_root nginx -s reload
  fi

  run_root certbot --nginx -d "$DOMAIN" --redirect -m "$EMAIL" --agree-tos --non-interactive
  set_env_value "$env_file" "COOKIE_SECURE" "true"

  info "COOKIE_SECURE 已切换为 true，开始重新创建容器"
  docker_compose up -d --force-recreate api web
  wait_for_http_ready
  save_state

  ok "HTTPS 已接入"
  echo "访问地址：https://${DOMAIN}"
}

print_menu() {
  echo
  echo "=========== opaccout_admin Docker 部署脚本 ==========="
  echo "1) 拉代码 + 配置 .env + Docker 部署"
  echo "2) 接入域名 HTTPS"
  echo "3) 配置环境变量 (.env)"
  echo "4) 查看服务状态"
  echo "5) 查看日志"
  echo "6) 重启服务"
  echo "7) 拉取最新代码并重建"
  echo "8) 停止服务（保留数据卷）"
  echo "9) 卸载服务及数据"
  echo "10) 查看管理员账号"
  echo "11) 重置管理员密码"
  echo "0) 退出"
  echo "===================================================="
}

interactive_main() {
  while true; do
    print_menu
    printf '请选择 [0-11]: ' >&2
    local choice
    read -r choice
    choice="$(trim "$choice")"
    case "$choice" in
      1) deploy_app ;;
      2) setup_https ;;
      3) configure_env_command ;;
      4) status_app ;;
      5)
        printf '可选服务 [api/web/mongo，留空查看全部]: ' >&2
        local service
        read -r service
        service="$(trim "$service")"
        logs_app "$service"
        ;;
      6) restart_app ;;
      7) rebuild_app ;;
      8) down_app ;;
      9) uninstall_app ;;
      10) list_admin_users_db ;;
      11) reset_admin_password ;;
      0) exit 0 ;;
      *) warn "无效选项" ;;
    esac
  done
}

main() {
  case "${1:-}" in
    deploy) deploy_app ;;
    https) setup_https ;;
    env) configure_env_command ;;
    status) status_app ;;
    logs) logs_app "${2:-}" ;;
    restart) restart_app ;;
    rebuild) rebuild_app ;;
    down) down_app ;;
    uninstall) uninstall_app ;;
    admins) list_admin_users_db ;;
    reset-admin-password) reset_admin_password ;;
    "")
      interactive_main
      ;;
    *)
      error "不支持的命令: $1"
      echo "可用命令: deploy | https | env | status | logs [api|web|mongo] | restart | rebuild | down | uninstall | admins | reset-admin-password"
      exit 1
      ;;
  esac
}

main "$@"
