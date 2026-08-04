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
chmod +x ./deploy-opaccout-admin.sh
./deploy-opaccout-admin.sh
```

也支持命令行子命令：

```bash
./deploy-opaccout-admin.sh deploy
./deploy-opaccout-admin.sh status
./deploy-opaccout-admin.sh logs api
./deploy-opaccout-admin.sh https
./deploy-opaccout-admin.sh admins
./deploy-opaccout-admin.sh reset-admin-password
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
如果 `graph.qq.com` 需要走代理，可额外配置：

```dotenv
QQ_OP_SOCKS_PROXY_URL=socks5://127.0.0.1:1080
```

也支持代理池，条目之间可用换行、英文逗号或分号分隔，例如：

```dotenv
QQ_OP_SOCKS_PROXY_URL=198.64.244.205:50101:tztright:t5sYiBK8tD,127.0.0.1:1081,socks5://user:pass@10.0.0.2:9000
```

支持的单条格式：

- `socks5://host:port`
- `socks5://user:pass@host:port`
- `host:port`
- `host:port:user:pass`
- `user:pass@host:port`

请求会按代理池轮询起始节点；当前代理连不上时，会自动切换到下一个代理继续请求。

该代理只作用于 QQ OP 昵称查询请求，不影响抖音检测接口或其他 API。

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

生产环境固定使用两个域名，不能把公开短 OP 服务放到后台域名下：

- 后台（完整 Web 和管理员 API）：`https://tkacc.tztright.top/login`
- 公开短 OP 页面：`https://op.tztright.qzz.io/`
- 分享链接：`https://op.tztright.qzz.io/123456789`（将 `123456789` 换成账号的 9 位短 OP）
- 公开解析 API：`POST https://op.tztright.qzz.io/api/op/resolve`

公开域名只转发上述解析 API；其他 `/api/` 路径会返回 `404`，后台管理 API
只能从后台域名访问。短 OP 等同于可用于解析 OP 数据的凭证，分享时仅发放给
授权对象，不要在日志、截图或工单中记录完整 OP。

部署脚本的 `https` 子命令会分别生成两个 Nginx 主机配置，并为两个域名分别
申请证书。执行前，必须先让 `tkacc.tztright.top` 和 `op.tztright.qzz.io` 的
DNS A/AAAA 记录都指向这台服务器，且服务器的 TCP `80`、`443` 已可从公网访问。
脚本会逐个记录证书结果：一个域名申请失败不会撤销另一个已成功的证书或配置，
但命令仍会以非零状态退出，修复 DNS/网络后重新执行即可。

Docker Compose 会将 Web 容器仅绑定到本机 `127.0.0.1:${WEB_PORT:-8080}`。公网只应
访问这台机器上的外层 Nginx 的 `80`、`443`；不要把 `WEB_PORT` 放行到公网，也不要
用其他服务器直接反向代理容器端口。

Android APK 的默认短 OP API 基址也是 `https://op.tztright.qzz.io`；APK 的 9 位
短 OP 模式需要联网访问这个地址，完整 OP 模式不依赖公开 API。

直接使用本机 HTTP 时设置：

```dotenv
COOKIE_SECURE=false
```

部署到 HTTPS 域名后，必须改为：

```dotenv
COOKIE_SECURE=true
```

部署脚本在本机 Nginx 上由 Certbot 终止 TLS，并以该 Nginx 自己的 `$scheme` 重写
`X-Forwarded-Proto`。不要让面板、CDN 或任意上游传来的同名请求头直接成为应用的
受信输入；若另有入口代理，应让它转发到本机 Nginx 的 HTTPS 入口，而不是绕过该边界。

外层双域名 Nginx 会清除客户端伪造的 `X-Forwarded-For`，以实际对端 IP 重建
转发链；容器内 Web Nginx 再追加自身内网跳点，和 API 的受控内网代理信任设置
保持一致。不要绕过外层 Nginx 直接把 Docker Web 端口暴露到公网。

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
