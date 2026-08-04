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
APT_CACHE_DIR="/var/cache/${APP_SLUG}"
APT_UPDATE_STAMP="${APT_CACHE_DIR}/apt-updated-at"
APT_SOURCES_BACKUP_DIR="${APT_CACHE_DIR}/apt-sources"
APT_UPDATE_CACHE_SECONDS=1800

PROJECT_DIR=""
REPO_URL=""
BRANCH=""
ADMIN_DOMAIN="tkacc.tztright.top"
OP_PUBLIC_DOMAIN="op.tztright.qzz.io"
# Kept only to migrate state files written by releases before the dual-domain split.
DOMAIN=""
EMAIL=""

trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_domain() {
  local domain
  domain="$(trim "${1:-}")"
  domain="${domain%.}"
  domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$domain"
}

validate_distinct_domains() {
  local admin_domain="$1" public_domain="$2"
  if [[ "$admin_domain" == "$public_domain" ]]; then
    error "后台域名和公开短 OP 域名不能相同"
    return 1
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

apt_primary_mirror() {
  local arch=""
  if command_exists dpkg; then
    arch="$(dpkg --print-architecture 2>/dev/null || true)"
  fi

  case "$arch" in
    amd64|i386)
      printf '%s' "http://archive.ubuntu.com/ubuntu"
      ;;
    *)
      printf '%s' "http://ports.ubuntu.com/ubuntu-ports"
      ;;
  esac
}

apt_sources_files() {
  local path=""
  for path in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [[ -e "$path" ]] || continue
    printf '%s\n' "$path"
  done
}

apt_update_recently() {
  [[ -f "$APT_UPDATE_STAMP" ]] || return 1

  local now="" last=""
  now="$(date +%s)"
  last="$(cat "$APT_UPDATE_STAMP" 2>/dev/null || echo 0)"
  [[ "$last" =~ ^[0-9]+$ ]] || return 1

  (( now - last < APT_UPDATE_CACHE_SECONDS ))
}

mark_apt_updated() {
  run_root install -d -m 0755 "$APT_CACHE_DIR"
  printf '%s\n' "$(date +%s)" | run_root tee "$APT_UPDATE_STAMP" >/dev/null
}

backup_apt_sources() {
  run_root install -d -m 0755 "$APT_SOURCES_BACKUP_DIR"

  local path="" backup_name=""
  while IFS= read -r path; do
    backup_name="$(printf '%s' "$path" | sed 's#^/##; s#/#__#g').bak"
    run_root cp "$path" "${APT_SOURCES_BACKUP_DIR}/${backup_name}"
  done < <(apt_sources_files)
}

switch_ubuntu_sources_to_official() {
  local mirror=""
  mirror="$(apt_primary_mirror)"
  info "切换 Ubuntu 软件源到 ${mirror}"
  backup_apt_sources

  local path=""
  while IFS= read -r path; do
    run_root sed -i'.opaccoutbak' \
      -e "s#https\\?://anycast-mirrors\\.as25820\\.net/ubuntu#${mirror}#g" \
      -e "s#https\\?://security\\.ubuntu\\.com/ubuntu#${mirror}#g" \
      -e "s#https\\?://[A-Za-z0-9.-]*archive\\.ubuntu\\.com/ubuntu#${mirror}#g" \
      -e "s#https\\?://ports\\.ubuntu\\.com/ubuntu-ports#${mirror}#g" \
      "$path"
    run_root rm -f "${path}.opaccoutbak"
  done < <(apt_sources_files)
}

apt_update_fast() {
  local force_update="${1:-}"

  if [[ "$force_update" != "force" ]] && apt_update_recently; then
    info "APT 索引在最近 ${APT_UPDATE_CACHE_SECONDS} 秒内已更新，跳过重复更新"
    return 0
  fi

  local retried_with_official_mirror=0
  while true; do
    if run_root env DEBIAN_FRONTEND=noninteractive apt-get update \
      -o Acquire::Languages=none \
      -o Acquire::Retries=3 \
      -o Acquire::ForceIPv4=true \
      -o Acquire::http::Timeout="10" \
      -o Acquire::https::Timeout="10" \
      -o Acquire::http::No-Cache=true \
      -o Acquire::http::Pipeline-Depth=0; then
      mark_apt_updated
      return 0
    fi

    if (( retried_with_official_mirror == 0 )) && ask_yes_no "APT 更新失败，是否切换到 Ubuntu 官方源后重试" "y"; then
      switch_ubuntu_sources_to_official
      retried_with_official_mirror=1
      force_update="force"
      continue
    fi

    return 1
  done
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
  local tmp_file
  ensure_state_dir || return 1
  tmp_file="$(mktemp)" || return 1
  if ! {
    printf 'PROJECT_DIR=%q\n' "$PROJECT_DIR"
    printf 'REPO_URL=%q\n' "$REPO_URL"
    printf 'BRANCH=%q\n' "$BRANCH"
    printf 'ADMIN_DOMAIN=%q\n' "${ADMIN_DOMAIN:-}"
    printf 'OP_PUBLIC_DOMAIN=%q\n' "${OP_PUBLIC_DOMAIN:-}"
    printf 'EMAIL=%q\n' "${EMAIL:-}"
  } > "$tmp_file"; then
    rm -f "$tmp_file"
    return 1
  fi
  if ! install -m 0600 "$tmp_file" "$STATE_FILE"; then
    rm -f "$tmp_file"
    return 1
  fi
  rm -f "$tmp_file"
}

load_state() {
  [[ -f "$STATE_FILE" ]] || return 1
  set +u
  ADMIN_DOMAIN=""
  OP_PUBLIC_DOMAIN=""
  source "$STATE_FILE"
  set -u

  if [[ -z "${ADMIN_DOMAIN:-}" && -n "${DOMAIN:-}" ]]; then
    ADMIN_DOMAIN="$DOMAIN"
  fi
  ADMIN_DOMAIN="${ADMIN_DOMAIN:-tkacc.tztright.top}"
  OP_PUBLIC_DOMAIN="${OP_PUBLIC_DOMAIN:-op.tztright.qzz.io}"
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
  
  if command_exists apt-get; then
    info "检测到 Ubuntu/Debian 系统，使用官方源快速安装 Docker"
    run_root install -m 0755 -d /etc/apt/keyrings
    run_root curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    run_root chmod a+r /etc/apt/keyrings/docker.asc
    
    # 动态获取系统版本代号并添加源
    local codename
    codename="$(lsb_release -cs)"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" | run_root tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    info "更新源并安装 Docker"
    apt_update_fast force
    apt_install_fast docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    # 针对非 Debian 系统，或者降级走一键脚本
    if ask_yes_no "非 Debian 系统，是否使用阿里云 Docker 镜像源加速一键安装（海外机选 n）" "n"; then
      curl -fsSL https://get.docker.com | run_root env CHANNEL=stable sh -s docker --mirror Aliyun
    else
      info "执行 Docker 官方一键安装脚本..."
      curl -fsSL https://get.docker.com | run_root sh
    fi
  fi

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
  local current_douyin_api current_qq_api current_qq_socks current_qq_app_id current_qq_timeout current_web_port current_tz current_cookie_secure

  current_session="$(read_env_value "$env_file" "SESSION_SECRET")"
  current_encrypt="$(read_env_value "$env_file" "FIELD_ENCRYPTION_KEY")"
  current_mongo_user="$(read_env_value "$env_file" "MONGO_ROOT_USERNAME")"
  current_mongo_pass="$(read_env_value "$env_file" "MONGO_ROOT_PASSWORD")"
  current_mongo_db="$(read_env_value "$env_file" "MONGO_DATABASE")"
  current_douyin_api="$(read_env_value "$env_file" "DOUYIN_CHECK_API_URL")"
  current_qq_api="$(read_env_value "$env_file" "QQ_OP_PROFILE_API_URL")"
  current_qq_socks="$(read_env_value "$env_file" "QQ_OP_SOCKS_PROXY_URL")"
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
  [[ -z "$current_qq_socks" ]] && current_qq_socks="$(read_env_value "$example_file" "QQ_OP_SOCKS_PROXY_URL")"
  [[ -z "$current_qq_app_id" ]] && current_qq_app_id="$(read_env_value "$example_file" "QQ_OP_APP_ID")"
  [[ -z "$current_qq_timeout" ]] && current_qq_timeout="$(read_env_value "$example_file" "QQ_OP_PROFILE_TIMEOUT_MS")"
  [[ -z "$current_web_port" ]] && current_web_port="$(read_env_value "$example_file" "WEB_PORT")"
  [[ -z "$current_tz" ]] && current_tz="$(read_env_value "$example_file" "TZ")"
  [[ -z "$current_cookie_secure" ]] && current_cookie_secure="$(read_env_value "$example_file" "COOKIE_SECURE")"

  current_mongo_user="${current_mongo_user:-douyin_admin}"
  current_mongo_db="${current_mongo_db:-douyin_accounts}"
  current_douyin_api="${current_douyin_api:-https://unid.tztright.top/check}"
  current_qq_api="${current_qq_api:-https://graph.qq.com/user/get_simple_userinfo}"
  current_qq_socks="${current_qq_socks:-}"
  current_qq_app_id="${current_qq_app_id:-1105602870}"
  current_qq_timeout="${current_qq_timeout:-5000}"
  current_web_port="${current_web_port:-8080}"
  current_tz="${current_tz:-Asia/Shanghai}"
  current_cookie_secure="${current_cookie_secure:-false}"

  local new_mongo_user new_mongo_pass new_mongo_db new_session new_encrypt
  local new_douyin_api new_qq_api new_qq_socks new_qq_app_id new_qq_timeout new_web_port new_tz new_cookie_secure

  new_mongo_user="$(prompt_default "MongoDB 超级用户名 (MONGO_ROOT_USERNAME)" "$current_mongo_user")"
  new_mongo_pass="$(prompt_default "MongoDB 超级密码 (MONGO_ROOT_PASSWORD)" "$current_mongo_pass")"
  new_mongo_db="$(prompt_default "MongoDB 数据库名 (MONGO_DATABASE)" "$current_mongo_db")"
  new_session="$(prompt_default "会话密钥 (SESSION_SECRET)" "$current_session")"
  new_encrypt="$(prompt_default "字段加密密钥 Base64 (FIELD_ENCRYPTION_KEY)" "$current_encrypt")"
  new_douyin_api="$(prompt_default "抖音检测接口 (DOUYIN_CHECK_API_URL)" "$current_douyin_api")"
  new_qq_api="$(prompt_default "QQ OP 查询接口 (QQ_OP_PROFILE_API_URL)" "$current_qq_api")"
  new_qq_socks="$(prompt_default "QQ OP SOCKS 代理/代理池 (QQ_OP_SOCKS_PROXY_URL)" "$current_qq_socks")"
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
QQ_OP_SOCKS_PROXY_URL=${new_qq_socks}
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
  echo "如需双域名 HTTPS，可继续执行脚本菜单中的“接入双域名 HTTPS（后台 + 公开 OP）”。"
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
  echo "后台域名：https://${ADMIN_DOMAIN:-未配置}/login"
  echo "公开短 OP 页面：https://${OP_PUBLIC_DOMAIN:-未配置}/"
  echo "公开短 OP API：https://${OP_PUBLIC_DOMAIN:-未配置}/api/op/resolve"
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

nginx_sites_enabled_dir() {
  printf '%s' "${NGINX_SITES_ENABLED_DIR:-/etc/nginx/sites-enabled}"
}

nginx_conf_d_prefix() {
  printf '%s' "${NGINX_CONF_D_PREFIX:-/etc/nginx/conf.d}"
}

enable_nginx_conf_if_needed() {
  local conf_file="$1" enabled_dir conf_d_prefix
  enabled_dir="$(nginx_sites_enabled_dir)"
  conf_d_prefix="$(nginx_conf_d_prefix)"
  if [[ "$conf_file" == "${conf_d_prefix}"/* ]]; then
    run_root rm -f "${enabled_dir}/$(basename "$conf_file")" || return 1
    return 0
  fi
  if [[ -d "$enabled_dir" ]]; then
    run_root ln -sf "$conf_file" "${enabled_dir}/$(basename "$conf_file")" || return 1
  fi
}

nginx_enabled_link_for_conf() {
  local conf_file="$1" enabled_dir
  enabled_dir="$(nginx_sites_enabled_dir)"
  [[ -d "$enabled_dir" ]] || return 1
  printf '%s/%s' "$enabled_dir" "$(basename "$conf_file")"
}

backup_nginx_conf() {
  local conf_file="$1" backup_file="$2"
  if [[ -f "$conf_file" ]]; then
    run_root cp "$conf_file" "$backup_file" || return 1
    run_root touch "${backup_file}.exists" || return 1
  else
    rm -f "$backup_file" "${backup_file}.exists"
  fi
}

restore_nginx_conf() {
  local conf_file="$1" backup_file="$2"
  if [[ -f "${backup_file}.exists" ]]; then
    run_root install -m 0644 "$backup_file" "$conf_file" || return 1
  else
    run_root rm -f "$conf_file" || return 1
  fi
}

discard_nginx_backup() {
  local backup_file="$1"
  rm -f "$backup_file" "${backup_file}.exists"
}

backup_nginx_site() {
  local conf_file="$1" enabled_link="$2" backup_file="$3"
  backup_nginx_conf "$conf_file" "$backup_file" || return 1
  [[ -n "$enabled_link" ]] || return 0

  rm -f "${backup_file}.enabled-symlink" "${backup_file}.enabled-file" "${backup_file}.enabled-target"
  if [[ -L "$enabled_link" ]]; then
    readlink "$enabled_link" > "${backup_file}.enabled-target" || return 1
    touch "${backup_file}.enabled-symlink"
  elif [[ -e "$enabled_link" ]]; then
    run_root cp -a "$enabled_link" "${backup_file}.enabled-file" || return 1
    touch "${backup_file}.enabled-file"
  fi
}

restore_nginx_site() {
  local conf_file="$1" enabled_link="$2" backup_file="$3"
  restore_nginx_conf "$conf_file" "$backup_file" || return 1
  [[ -n "$enabled_link" ]] || return 0

  if [[ -f "${backup_file}.enabled-symlink" ]]; then
    run_root rm -f "$enabled_link" || return 1
    run_root ln -s "$(cat "${backup_file}.enabled-target")" "$enabled_link" || return 1
  elif [[ -f "${backup_file}.enabled-file" ]]; then
    run_root rm -f "$enabled_link" || return 1
    run_root cp -a "${backup_file}.enabled-file" "$enabled_link" || return 1
  else
    run_root rm -f "$enabled_link" || return 1
  fi
}

discard_nginx_site_backup() {
  local backup_file="$1"
  discard_nginx_backup "$backup_file"
  rm -f "${backup_file}.enabled-symlink" "${backup_file}.enabled-file" "${backup_file}.enabled-target"
}

cleanup_nginx_backups() {
  local backup_dir="$1"
  if ! rm -rf "$backup_dir"; then
    error "Nginx 配置备份临时目录清理失败：${backup_dir}"
    return 1
  fi
}

reload_nginx_safely() {
  if ! run_root nginx -t; then
    error "Nginx 配置校验失败，未执行重载"
    return 1
  fi
  if command_exists systemctl; then
    run_root systemctl reload nginx
  else
    run_root nginx -s reload
  fi
}

rollback_nginx_sites() {
  local admin_conf_file="$1" admin_enabled_link="$2" admin_backup="$3"
  local public_conf_file="$4" public_enabled_link="$5" public_backup="$6"
  local rollback_failed=0

  restore_nginx_site "$admin_conf_file" "$admin_enabled_link" "$admin_backup" || rollback_failed=1
  restore_nginx_site "$public_conf_file" "$public_enabled_link" "$public_backup" || rollback_failed=1
  reload_nginx_safely || rollback_failed=1
  return "$rollback_failed"
}

write_admin_nginx_http_conf() {
  local conf_file="$1" admin_domain="$2" public_domain="$3" web_port="$4"
  local tmp_file
  tmp_file="$(mktemp)"

  cat > "$tmp_file" <<EOF
server {
    listen 80;
    server_name ${admin_domain};

    client_max_body_size 20m;

    location = /op {
        return 302 https://${public_domain}/;
    }

    location ~ ^/op/([1-9][0-9]{8})$ {
        return 302 https://${public_domain}/\$1\$is_args\$args;
    }

    location / {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

  if ! run_root install -m 0644 "$tmp_file" "$conf_file"; then
    rm -f "$tmp_file"
    return 1
  fi
  rm -f "$tmp_file"
}

write_public_op_nginx_http_conf() {
  local conf_file="$1" public_domain="$2" web_port="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  cat > "$tmp_file" <<EOF
server {
    listen 80;
    server_name ${public_domain};

    client_max_body_size 20m;

    location = /api/op/resolve {
        if (\$request_method != POST) { return 405; }
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location ^~ /api/ {
        return 404;
    }

    location /assets/ {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = / {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/[1-9][0-9]{8}$ {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /op {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/op/[1-9][0-9]{8}$ {
        proxy_pass http://127.0.0.1:${web_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        return 404;
    }
}
EOF

  if ! run_root install -m 0644 "$tmp_file" "$conf_file"; then
    rm -f "$tmp_file"
    return 1
  fi
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

  ADMIN_DOMAIN="$(normalize_domain "$(prompt_default "后台域名（如 admin.example.com）" "${ADMIN_DOMAIN:-tkacc.tztright.top}")")"
  OP_PUBLIC_DOMAIN="$(normalize_domain "$(prompt_default "公开短 OP 域名（如 op.example.com）" "${OP_PUBLIC_DOMAIN:-op.tztright.qzz.io}")")"
  [[ -n "$ADMIN_DOMAIN" ]] || { error "后台域名不能为空"; return 1; }
  [[ -n "$OP_PUBLIC_DOMAIN" ]] || { error "公开短 OP 域名不能为空"; return 1; }
  validate_distinct_domains "$ADMIN_DOMAIN" "$OP_PUBLIC_DOMAIN"
  EMAIL="$(prompt_default "证书邮箱" "${EMAIL:-admin@${ADMIN_DOMAIN}}")"
  check_domain_dns "$ADMIN_DOMAIN"
  check_domain_dns "$OP_PUBLIC_DOMAIN"

  local conf_dir admin_conf_file public_conf_file admin_enabled_link public_enabled_link
  local env_file backup_dir admin_backup public_backup
  conf_dir="$(nginx_conf_dir)"
  admin_conf_file="${conf_dir}/${ADMIN_DOMAIN}.conf"
  public_conf_file="${conf_dir}/${OP_PUBLIC_DOMAIN}.conf"
  admin_enabled_link="$(nginx_enabled_link_for_conf "$admin_conf_file" || true)"
  public_enabled_link="$(nginx_enabled_link_for_conf "$public_conf_file" || true)"
  env_file="${PROJECT_DIR}/.env"
  backup_dir="$(mktemp -d)"
  admin_backup="${backup_dir}/admin.conf"
  public_backup="${backup_dir}/public.conf"

  run_root mkdir -p "$conf_dir"
  if ! backup_nginx_site "$admin_conf_file" "$admin_enabled_link" "$admin_backup"; then
    cleanup_nginx_backups "$backup_dir" || true
    error "后台 Nginx 原配置备份失败"
    return 1
  fi
  if ! backup_nginx_site "$public_conf_file" "$public_enabled_link" "$public_backup"; then
    discard_nginx_site_backup "$admin_backup"
    cleanup_nginx_backups "$backup_dir" || true
    error "公开短 OP Nginx 原配置备份失败"
    return 1
  fi
  if ! write_admin_nginx_http_conf "$admin_conf_file" "$ADMIN_DOMAIN" "$OP_PUBLIC_DOMAIN" "$web_port"; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    error "后台 Nginx HTTP 配置写入失败"
    return 1
  fi
  if ! write_public_op_nginx_http_conf "$public_conf_file" "$OP_PUBLIC_DOMAIN" "$web_port"; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    error "公开短 OP Nginx HTTP 配置写入失败"
    return 1
  fi
  if ! enable_nginx_conf_if_needed "$admin_conf_file"; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    error "后台 Nginx 站点启用失败"
    return 1
  fi
  if ! enable_nginx_conf_if_needed "$public_conf_file"; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    error "公开短 OP Nginx 站点启用失败"
    return 1
  fi

  allow_firewall_port 80
  allow_firewall_port 443
  if ! reload_nginx_safely; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    return 1
  fi

  if ! save_state; then
    rollback_nginx_sites "$admin_conf_file" "$admin_enabled_link" "$admin_backup" "$public_conf_file" "$public_enabled_link" "$public_backup" || true
    cleanup_nginx_backups "$backup_dir" || true
    error "部署状态保存失败，已恢复 Nginx 原配置"
    return 1
  fi

  local admin_certificate_failed=0 public_certificate_failed=0
  local admin_rollback_failed=0 public_rollback_failed=0 cleanup_failed=0
  if run_root certbot --nginx -d "$ADMIN_DOMAIN" --redirect -m "$EMAIL" --agree-tos --non-interactive; then
    ok "后台域名证书已签发：${ADMIN_DOMAIN}"
    discard_nginx_site_backup "$admin_backup"
  else
    error "后台域名证书签发失败：${ADMIN_DOMAIN}"
    admin_certificate_failed=1
    if ! restore_nginx_site "$admin_conf_file" "$admin_enabled_link" "$admin_backup"; then
      error "后台域名配置恢复失败"
      admin_rollback_failed=1
    fi
    if ! reload_nginx_safely; then
      error "后台域名配置恢复后无法安全重载 Nginx"
      admin_rollback_failed=1
    fi
  fi

  if run_root certbot --nginx -d "$OP_PUBLIC_DOMAIN" --redirect -m "$EMAIL" --agree-tos --non-interactive; then
    ok "公开短 OP 域名证书已签发：${OP_PUBLIC_DOMAIN}"
    discard_nginx_site_backup "$public_backup"
  else
    error "公开短 OP 域名证书签发失败：${OP_PUBLIC_DOMAIN}"
    public_certificate_failed=1
    if ! restore_nginx_site "$public_conf_file" "$public_enabled_link" "$public_backup"; then
      error "公开短 OP 域名配置恢复失败"
      public_rollback_failed=1
    fi
    if ! reload_nginx_safely; then
      error "公开短 OP 域名配置恢复后无法安全重载 Nginx"
      public_rollback_failed=1
    fi
  fi

  if (( admin_certificate_failed == 0 )); then
    set_env_value "$env_file" "COOKIE_SECURE" "true"
    info "COOKIE_SECURE 已切换为 true，开始重新创建容器"
    docker_compose up -d --force-recreate api web
    wait_for_http_ready
  else
    warn "后台证书未签发，COOKIE_SECURE 保持原值"
  fi

  if ! cleanup_nginx_backups "$backup_dir"; then
    cleanup_failed=1
  fi

  if (( admin_certificate_failed != 0 || public_certificate_failed != 0 || admin_rollback_failed != 0 || public_rollback_failed != 0 || cleanup_failed != 0 )); then
    error "至少一个域名证书未签发；已保留成功域名的 Nginx/证书状态，请修复后重新执行 https"
    return 1
  fi

  ok "双域名 HTTPS 已接入"
  echo "后台：https://${ADMIN_DOMAIN}/login"
  echo "公开页面：https://${OP_PUBLIC_DOMAIN}/"
  echo "公开解析 API：https://${OP_PUBLIC_DOMAIN}/api/op/resolve"
}

print_menu() {
  echo
  echo "=========== opaccout_admin Docker 部署脚本 ==========="
  echo "1) 拉代码 + 配置 .env + Docker 部署"
  echo "2) 接入双域名 HTTPS（后台 + 公开 OP）"
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
