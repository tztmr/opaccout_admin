#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  echo "缺少 .env，请先执行 cp .env.example .env 并替换全部示例密码和密钥。" >&2
  exit 1
fi

web_port="${WEB_PORT:-}"
if [ -z "$web_port" ]; then
  web_port="$(sed -n 's/^WEB_PORT=//p' .env | tail -1)"
fi
web_port="${web_port:-8080}"

docker compose config --quiet
docker compose build
docker compose up -d

curl --fail --silent --show-error "http://localhost:${web_port}/" >/dev/null
curl --fail --silent --show-error "http://localhost:${web_port}/api/health/ready" >/dev/null
docker compose ps
