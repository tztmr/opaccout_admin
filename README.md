# 抖音账号管理后台

一个单管理员、MongoDB 持久化的抖音账号管理后台。支持账号增删改查、`sec_uid` 与账号状态检测、OP 卡密加密保存、批量操作、Excel/CSV 导入导出、操作日志和 Docker 部署。

## 数据字段

账号表包含：抖音号、`sec_uid`、注册时间、OP名称、OP卡密、OP到期时间、归属人、售卖状态、账号状态和备注。

- 售卖状态：未售卖、已售卖、已停用、已找回
- 账号状态：正常、违规、封禁
- `sec_uid` 和账号状态由服务端通过抖音检测接口取得
- OP到期时间取卡密最后一段 10 位 Unix 秒级时间戳，再固定增加 60 天
- OP卡密使用 AES-256-GCM 字段级加密保存

## Docker 部署

需要 Docker Engine 与 Docker Compose v2。

```bash
cp .env.example .env
```

编辑 `.env`，必须替换管理员密码、MongoDB 密码、会话密钥和字段加密密钥。生成加密密钥：

```bash
openssl rand -base64 32
```

启动：

```bash
docker compose up -d --build
```

默认访问 `http://localhost:8080`，使用 `.env` 中唯一的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。只有 Web 端口暴露给宿主机，API 和 MongoDB 不暴露宿主端口。

查看状态与日志：

```bash
docker compose ps
docker compose logs -f api
```

停止服务但保留数据：

```bash
docker compose down
```

MongoDB 数据保存在命名卷 `mongo_data`。不要执行 `docker compose down -v`，除非明确要删除全部账号数据。

### HTTPS

直接使用本机 HTTP 时设置：

```dotenv
COOKIE_SECURE=false
```

部署到 HTTPS 域名并由反向代理传递 `X-Forwarded-Proto` 后，必须改为：

```dotenv
COOKIE_SECURE=true
```

## 导入格式

导入支持 `.xlsx`、`.xls` 和 `.csv`，文件最大 10 MB。可在“导入记录”页面下载模板。模板字段：

```text
抖音号, 注册时间, OP名称, OP卡密, 归属人, 售卖状态, 备注
```

`sec_uid`、账号状态和 OP 到期时间由服务端生成，导入文件中的同名字段不会被信任。

## 本地开发

```bash
pnpm install
pnpm --filter @douyin-admin/api dev
pnpm --filter @douyin-admin/web dev
```

前端开发地址默认为 `http://localhost:5173`，Vite 会把 `/api` 代理到 `http://localhost:3000`。

## 验证

配置好 `.env` 后可运行：

```bash
sh scripts/smoke-docker.sh
```

代码级检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```
