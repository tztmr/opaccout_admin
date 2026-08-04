import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(admin, /location ~ \^\/op\/\(\[1-9\]\[0-9\]\{8\}\)\$\s*\{[\s\S]*return 302 https:\/\/op\.tztright\.qzz\.io\/\$1/);
  assert.match(admin, /location \/\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(admin, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(admin, /proxy_set_header X-Forwarded-Proto \$scheme;/);

  assert.match(publicOp, /server_name op\.tztright\.qzz\.io;/);
  assert.match(publicOp, /location = \/api\/op\/resolve\s*\{[\s\S]*if \(\$request_method != POST\) \{ return 405; \}/);
  assert.match(publicOp, /location = \/api\/op\/resolve\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location \^~ \/api\/\s*\{\s*return 404;/);
  assert.match(publicOp, /location \/assets\/\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  assert.match(publicOp, /location ~ \^\/\[1-9\]\[0-9\]\{8\}\$\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/);
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
