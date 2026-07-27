FROM node:22-alpine AS builder

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @douyin-admin/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
