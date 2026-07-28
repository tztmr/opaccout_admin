# 抖音账号管理后台

一个单管理员、MongoDB 持久化的抖音账号管理后台。支持账号增删改查、`sec_uid` 与账号状态检测、OP 卡密加密保存、批量操作、Excel/CSV 导入导出、操作日志和 Docker 部署。

## 数据字段

账号表包含：抖音号、`sec_uid`、注册时间、OP名称、OP卡密、OP到期时间、归属人、售卖状态、账号状态和备注。

- 售卖状态：未知、未售卖、已售卖、已停用、已找回
- 账号状态：正常、违规、封禁
- 新建账号及导入时未填写或留空的售卖状态默认为“未知”
- 封禁账号由服务端永久锁定为“已停用”，单条和批量修改都不能解除
- 归属人筛选项从当前数据库中的非空归属人实时去重生成
- `sec_uid` 和账号状态由服务端通过抖音检测接口取得
- 新增账号入库前由服务端通过 QQ API 核对 OP卡密，成功时以 API 的昵称作为 OP名称
- OP到期时间取卡密最后一段 10 位 Unix 秒级时间戳，再固定增加 60 天
- OP卡密使用 AES-256-GCM 字段级加密保存

### OP名称核对

后台手动新增和批量导入中实际新增的账号，会在服务端查询 QQ OP 资料：

- `ret = 0`：使用 API 返回的 `nickname` 覆盖提交或导入的 OP名称，保留原售卖状态
- `ret = -22`：保留提交的 OP名称，售卖状态强制设为“已停用”
- 其他 `ret`：保留 OP名称和售卖状态，在备注后追加 `OP: <msg>`
- 超时、断网、非 JSON、响应格式异常：继续入库，并在备注后追加 `OP: 查询失败`

已有备注不会被覆盖，追加格式为 `<原备注> | OP: <消息>`。编辑已有账号、
重新检测抖音状态以及导入时跳过或更新重复账号，都不会调用 QQ OP API。
抖音封禁账号仍按最高优先级永久锁定为“已停用”。

## Docker 部署

需要 Docker Engine 与 Docker Compose v2。

如果你希望像 `deploy-oplogin.sh` 那样用一个交互式脚本完成拉代码、写 `.env`、启动容器和接入 HTTPS，可以直接使用仓库根目录的：

```bash
chmod +x ./deploy-opacout-admin.sh
./deploy-opacout-admin.sh
```

也支持命令行子命令：

```bash
./deploy-opacout-admin.sh deploy
./deploy-opacout-admin.sh status
./deploy-opacout-admin.sh logs api
./deploy-opacout-admin.sh https
```

```bash
cp .env.example .env
```

编辑 `.env`，必须替换 MongoDB 密码、会话密钥和字段加密密钥。管理员账号不在这里配置，首次打开后台时注册。生成加密密钥：

```bash
openssl rand -base64 32
```

QQ OP 查询默认配置如下，通常不需要修改：

```dotenv
QQ_OP_PROFILE_API_URL=https://graph.qq.com/user/get_simple_userinfo
QQ_OP_APP_ID=1105602870
QQ_OP_PROFILE_TIMEOUT_MS=5000
```

QQ API 地址必须使用 HTTPS，超时时间允许设置为 100 至 30000 毫秒。

启动。项目路径包含中文时使用传统构建器，可避开部分 Docker Desktop
版本的 Buildx Bake 路径编码问题：

```bash
DOCKER_BUILDKIT=0 docker compose up -d --build
```

首次部署后打开 `http://localhost:8080`。如果 MongoDB 中还没有管理员，页面会自动显示“注册管理员”；注册成功后自动登录，注册页面随即关闭。之后重启或重新构建容器都只显示登录页，因为管理员凭据保存在 `mongo_data` 数据卷中。只有 Web 端口暴露给宿主机，API 和 MongoDB 不暴露宿主端口。

系统不使用 `ADMIN_USERNAME`、`ADMIN_PASSWORD`，也不提供网页密码重置。请备份 MongoDB 数据卷和管理员密码；丢失密码需要由运维人员直接执行受控恢复，不能通过重新添加旧环境变量绕过登录。

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
