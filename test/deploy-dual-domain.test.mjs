import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const deployScriptPath = join(repositoryRoot, "deploy-opaccout-admin.sh");
const adminDomain = "tkacc.tztright.top";
const publicDomain = "op.tztright.qzz.io";

function renderOuterNginx(functionName, ...args) {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-"));
  const sourcePath = join(workDir, "deploy.sh");
  const outputPath = join(workDir, "site.conf");

  try {
    const script = readFileSync(deployScriptPath, "utf8");
    // Exercise the real shell functions without invoking the deployment menu.
    writeFileSync(sourcePath, script.replace(/\nmain "\$@"\s*$/, "\n"));
    execFileSync(
      "bash",
      [
        "-c",
        'source "$1"; shift; run_root() { "$@"; }; "$@"',
        "bash",
        sourcePath,
        functionName,
        outputPath,
        ...args
      ],
      { stdio: "pipe" }
    );
    return readFileSync(outputPath, "utf8");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function runTestableDeployScript(command, args = []) {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-"));
  const sourcePath = join(workDir, "deploy.sh");

  try {
    const script = readFileSync(deployScriptPath, "utf8");
    writeFileSync(sourcePath, script.replace(/\nmain "\$@"\s*$/, "\n"));
    return execFileSync("bash", ["-c", command, "bash", sourcePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

test("renders separate admin and public OP hosts with their intended boundaries", () => {
  const admin = renderOuterNginx(
    "write_admin_nginx_http_conf",
    adminDomain,
    publicDomain,
    "8080"
  );
  const publicOp = renderOuterNginx(
    "write_public_op_nginx_http_conf",
    publicDomain,
    "8080"
  );

  assert.match(admin, /server_name tkacc\.tztright\.top;/);
  assert.match(admin, /location = \/op\s*\{[\s\S]*return 302 https:\/\/op\.tztright\.qzz\.io\//);
  assert.match(admin, /location ~ "\^\/op\/\(\[1-9\]\[0-9\]\{8\}\)\$"\s*\{[\s\S]*return 302 https:\/\/op\.tztright\.qzz\.io\/\$1/);
  assert.match(admin, /location \/\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(admin, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(admin, /proxy_set_header X-Forwarded-Proto \$scheme;/);

  assert.match(publicOp, /server_name op\.tztright\.qzz\.io;/);
  assert.match(publicOp, /location = \/api\/op\/resolve\s*\{[\s\S]*if \(\$request_method != POST\) \{ return 405; \}/);
  assert.match(publicOp, /location = \/api\/op\/resolve\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location \^~ \/api\/\s*\{\s*return 404;/);
  assert.match(publicOp, /location \/assets\/\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location ~ "\^\/\[1-9\]\[0-9\]\{8\}\$"\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location ~ "\^\/op\/\[1-9\]\[0-9\]\{8\}\$"\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location \/\s*\{\s*return 404;/);
});

test("migrates a legacy DOMAIN state and requests a certificate for each new domain", () => {
  const script = readFileSync(deployScriptPath, "utf8");
  const executable = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  assert.match(executable, /ADMIN_DOMAIN="tkacc\.tztright\.top"/);
  assert.match(executable, /OP_PUBLIC_DOMAIN="op\.tztright\.qzz\.io"/);
  assert.match(executable, /if \[\[ -z "\$\{ADMIN_DOMAIN:-\}" && -n "\$\{DOMAIN:-\}" \]\]; then\s*ADMIN_DOMAIN="\$DOMAIN"/);
  assert.match(executable, /printf 'ADMIN_DOMAIN=%q\\n' "\$\{ADMIN_DOMAIN:-\}"/);
  assert.match(executable, /printf 'OP_PUBLIC_DOMAIN=%q\\n' "\$\{OP_PUBLIC_DOMAIN:-\}"/);
  assert.match(executable, /certbot --nginx -d "\$ADMIN_DOMAIN" --redirect/);
  assert.match(executable, /certbot --nginx -d "\$OP_PUBLIC_DOMAIN" --redirect/);
  assert.match(executable, /接入双域名 HTTPS（后台 \+ 公开 OP）/);
  assert.match(executable, /如需双域名 HTTPS，可继续执行脚本菜单中的“接入双域名 HTTPS（后台 \+ 公开 OP）”。/);
});

test("normalizes domains before rejecting a shared admin and public host", () => {
  const output = runTestableDeployScript(
    'source "$1"; admin="$(normalize_domain " TKACC.TZTRIGHT.TOP. ")"; public="$(normalize_domain "tkacc.tztright.top")"; printf "%s|%s\\n" "$admin" "$public"; ! validate_distinct_domains "$admin" "$public"'
  );

  assert.equal(output, "tkacc.tztright.top|tkacc.tztright.top\n");
});

test("backs up and restores each Nginx host independently after a certificate failure", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-config-"));
  const adminConfig = join(workDir, "admin.conf");
  const publicConfig = join(workDir, "public.conf");
  const adminBackup = join(workDir, "admin.backup");
  const publicBackup = join(workDir, "public.backup");

  try {
    writeFileSync(adminConfig, "old-admin\n");
    writeFileSync(publicConfig, "old-public\n");
    runTestableDeployScript(
      'source "$1"; run_root() { "$@"; }; backup_nginx_conf "$2" "$4"; backup_nginx_conf "$3" "$5"; printf "new-admin\\n" > "$2"; printf "new-public\\n" > "$3"; restore_nginx_conf "$3" "$5"; test "$(cat "$2")" = "new-admin"; test "$(cat "$3")" = "old-public"',
      [adminConfig, publicConfig, adminBackup, publicBackup]
    );

    assert.equal(readFileSync(adminConfig, "utf8"), "new-admin\n");
    assert.equal(readFileSync(publicConfig, "utf8"), "old-public\n");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("restores the original site activation and removes a symlink created on first deployment", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-activation-"));
  const enabledDir = join(workDir, "sites-enabled");
  const adminConfig = join(workDir, "admin.conf");
  const publicConfig = join(workDir, "public.conf");
  const adminLink = join(enabledDir, "admin.conf");
  const publicLink = join(enabledDir, "public.conf");
  const adminBackup = join(workDir, "admin.backup");
  const publicBackup = join(workDir, "public.backup");

  try {
    execFileSync("mkdir", ["-p", enabledDir]);
    writeFileSync(adminConfig, "old-admin\n");
    writeFileSync(join(workDir, "old-public.conf"), "old-public\n");
    execFileSync("ln", ["-s", join(workDir, "old-public.conf"), publicLink]);

    runTestableDeployScript(
      'source "$1"; run_root() { "$@"; }; backup_nginx_site "$2" "$4" "$6"; backup_nginx_site "$3" "$5" "$7"; printf "new-admin\\n" > "$2"; printf "new-public\\n" > "$3"; rm -f "$4" "$5"; ln -s "$3" "$4"; ln -s "$3" "$5"; restore_nginx_site "$2" "$4" "$6"; restore_nginx_site "$3" "$5" "$7"; test "$(cat "$2")" = "old-admin"; test ! -e "$3"; test ! -L "$4"; test "$(readlink "$5")" = "' + join(workDir, "old-public.conf") + '"',
      [adminConfig, publicConfig, adminLink, publicLink, adminBackup, publicBackup]
    );

    assert.equal(readFileSync(adminConfig, "utf8"), "old-admin\n");
    assert.equal(readFileSync(publicLink, "utf8"), "old-public\n");
    assert.equal(existsSync(publicConfig), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("restores a same-name enabled entry when a conf.d site removes it", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-confd-"));
  const enabledDir = join(workDir, "sites-enabled");
  const configPath = join(workDir, "conf.d", "admin.conf");
  const enabledPath = join(enabledDir, "admin.conf");
  const backupPath = join(workDir, "admin.backup");
  const originalTarget = join(workDir, "previous-admin.conf");

  try {
    execFileSync("mkdir", ["-p", join(workDir, "conf.d"), enabledDir]);
    writeFileSync(configPath, "new-admin\n");
    writeFileSync(originalTarget, "old-admin\n");
    execFileSync("ln", ["-s", originalTarget, enabledPath]);

    runTestableDeployScript(
      'source "$1"; NGINX_SITES_ENABLED_DIR="$2"; NGINX_CONF_D_PREFIX="$(dirname "$3")"; run_root() { "$@"; }; enabled="$(nginx_enabled_link_for_conf "$3")"; test "$enabled" = "$4"; backup_nginx_site "$3" "$enabled" "$5"; enable_nginx_conf_if_needed "$3"; test ! -L "$4"; restore_nginx_site "$3" "$enabled" "$5"; test "$(readlink "$4")" = "$6"',
      [enabledDir, configPath, enabledPath, backupPath, originalTarget]
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("treats a conf.d activation cleanup failure as a dual-site rollback error", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-confd-cleanup-"));
  const confDir = join(workDir, "conf.d");
  const enabledDir = join(workDir, "sites-enabled");
  const adminConfig = join(confDir, "tkacc.tztright.top.conf");
  const publicConfig = join(confDir, "op.tztright.qzz.io.conf");
  const adminEnabled = join(enabledDir, "tkacc.tztright.top.conf");

  try {
    execFileSync("mkdir", ["-p", confDir, enabledDir]);
    writeFileSync(join(workDir, ".env"), "WEB_PORT=8080\n");
    writeFileSync(adminConfig, "old-admin\n");
    writeFileSync(publicConfig, "old-public\n");
    writeFileSync(adminEnabled, "old-enabled\n");

    runTestableDeployScript(
      'source "$1"; PROJECT_DIR="$2"; NGINX_SITES_ENABLED_DIR="$3"; NGINX_CONF_D_PREFIX="$4"; FAIL_CLEANUP="$5"; load_state() { :; }; assert_project_layout() { :; }; ensure_docker_ready() { :; }; install_nginx_if_needed() { :; }; install_certbot_if_needed() { :; }; prompt_default() { printf "%s" "$2"; }; normalize_domain() { printf "%s" "$1"; }; validate_distinct_domains() { :; }; check_domain_dns() { :; }; nginx_conf_dir() { printf "%s" "$NGINX_CONF_D_PREFIX"; }; write_admin_nginx_http_conf() { printf "new-admin\\n" > "$1"; }; write_public_op_nginx_http_conf() { printf "new-public\\n" > "$1"; }; allow_firewall_port() { :; }; reload_nginx_safely() { :; }; save_state() { :; }; docker_compose() { :; }; wait_for_http_ready() { :; }; set_env_value() { :; }; run_root() { if [[ "$1" == "rm" && "$3" == "$FAIL_CLEANUP" ]]; then return 73; fi; if [[ "$1" == "certbot" ]]; then return 0; fi; "$@"; }; ! setup_https; test "$(cat "$6")" = "old-admin"; test "$(cat "$7")" = "old-public"',
      [workDir, enabledDir, confDir, adminEnabled, adminConfig, publicConfig]
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("treats state persistence failure as a rollback-worthy error", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-state-"));
  try {
    runTestableDeployScript(
      'source "$1"; STATE_DIR="$2"; STATE_FILE="/dev/null/state.env"; ! save_state',
      [workDir]
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("fails a site write when Nginx configuration installation fails", () => {
  const workDir = mkdtempSync(join(tmpdir(), "deploy-dual-domain-write-"));
  const configPath = join(workDir, "site.conf");

  try {
    runTestableDeployScript(
      'source "$1"; run_root() { return 1; }; ! write_public_op_nginx_http_conf "$2" "op.tztright.qzz.io" "8080"',
      [configPath]
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("setup HTTPS has per-domain backup, rollback, and nonzero partial-failure paths", () => {
  const script = readFileSync(deployScriptPath, "utf8");
  const executable = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  assert.match(executable, /backup_nginx_site "\$admin_conf_file" "\$admin_enabled_link" "\$admin_backup"/);
  assert.match(executable, /backup_nginx_site "\$public_conf_file" "\$public_enabled_link" "\$public_backup"/);
  assert.match(executable, /rollback_nginx_sites "\$admin_conf_file" "\$admin_enabled_link" "\$admin_backup" "\$public_conf_file" "\$public_enabled_link" "\$public_backup"/);
  assert.match(executable, /if ! enable_nginx_conf_if_needed "\$admin_conf_file"/);
  assert.match(executable, /if ! enable_nginx_conf_if_needed "\$public_conf_file"/);
  assert.match(executable, /if ! save_state; then[\s\S]*rollback_nginx_sites/);
  assert.match(executable, /if ! restore_nginx_site "\$admin_conf_file" "\$admin_enabled_link" "\$admin_backup"; then[\s\S]*admin_rollback_failed=1/);
  assert.match(executable, /if ! restore_nginx_site "\$public_conf_file" "\$public_enabled_link" "\$public_backup"; then[\s\S]*public_rollback_failed=1/);
  assert.match(executable, /cleanup_nginx_backups/);
  assert.ok(
    executable.indexOf('certbot --nginx -d "$OP_PUBLIC_DOMAIN"') >
      executable.indexOf('if ! restore_nginx_site "$admin_conf_file"')
  );
  assert.match(executable, /reload_nginx_safely/);
  assert.match(executable, /return 1/);
});

test("publishes the Web container only to the local outer Nginx", () => {
  const compose = readFileSync(join(repositoryRoot, "docker-compose.yml"), "utf8");
  const executable = compose
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  assert.match(executable, /- "127\.0\.0\.1:\$\{WEB_PORT:-8080\}:8080"/);
});

test("container Nginx preserves the controlled proxy chain before the API", () => {
  const nginx = readFileSync(join(repositoryRoot, "apps/web/nginx.conf"), "utf8");
  const executable = nginx
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  assert.match(executable, /location \/api\/\s*\{[\s\S]*proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  assert.match(executable, /location \/api\/\s*\{[\s\S]*proxy_set_header X-Forwarded-Proto \$forwarded_proto;/);
  assert.match(executable, /map \$http_x_forwarded_proto \$forwarded_proto \{\s*default \$scheme;\s*http http;\s*https https;/);
});
