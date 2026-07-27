# 抖音账号管理后台设计说明

日期：2026-07-27

状态：已确认

## 1. 目标

构建一个可通过 Docker 部署、使用 MongoDB 持久化数据的单管理员后台，用于集中维护抖音账号资料。后台支持多设备访问，但只设置一个管理员账号和密码。

首期功能包括：

- 管理员登录、退出和登录状态校验
- 账号列表、分页、搜索和筛选
- 新增、查看、编辑和删除账号
- 批量选择与批量修改状态
- Excel/CSV 批量导入
- Excel/CSV 数据导出
- 导入记录和管理员操作日志
- Docker Compose 一键启动前端、API 与 MongoDB

## 2. 已确认的页面结构

采用“A · 紧凑侧边栏”浅色方案。

### 2.1 侧边栏

侧边栏固定包含：

1. 抖音账号
2. 导入记录
3. 操作日志
4. 系统设置

桌面端显示图标和文字；窄屏收起为图标栏。手机访问时主内容保持可操作，宽表格使用横向滚动，不把每行数据改成卡片。

### 2.2 账号列表顶部

页面标题为“抖音账号管理”，并显示以下统计：

- 全部账号
- 未售卖
- 已售卖
- 异常账号：账号状态为“违规”或“封禁”的总数

主要操作：

- 新增账号
- 导入 Excel/CSV
- 导出当前筛选结果

### 2.3 搜索与筛选

支持：

- 关键词搜索：抖音号、`sec_uid`、OP 名称、归属人、备注
- 售卖状态筛选
- 账号状态筛选
- 注册时间范围筛选
- 一键清空筛选条件

搜索输入使用防抖，筛选、页码和每页数量写入 URL 查询参数，刷新页面后保留。

### 2.4 表格字段顺序

表格从左到右固定为：

1. 选择框
2. 抖音号
3. `sec_uid`
4. 注册时间
5. OP 名称
6. OP 卡密
7. OP 到期时间
8. 归属人
9. 售卖状态
10. 账号状态
11. 备注
12. 操作

OP 卡密默认以圆点隐藏。管理员可单次查看或复制，离开当前行后恢复隐藏。`sec_uid` 在单元格内截断显示，悬停或进入详情时显示完整值并允许复制。

操作列提供“编辑”和“更多”。“更多”内包含查看详情、复制账号资料和删除。删除必须二次确认。

### 2.5 状态定义

售卖状态固定为：

- 未售卖
- 已售卖
- 已停用
- 已找回

账号状态固定为：

- 正常
- 违规
- 封禁

售卖状态由管理员维护，账号状态由抖音号检测 API 判定，两组状态互相独立。例如一个账号可以同时为“已售卖”和“违规”。系统不得根据其中一组状态自动修改另一组状态。

### 2.6 抖音号检测 API

API 地址为 `https://unid.tztright.top/check?num={抖音号}`。API 返回的外层 `body` 是 JSON 字符串，服务端需要再次解析该字符串，并且只提取必要字段，不把完整第三方响应写入数据库或日志。

字段来源：

- `sec_uid`：`body.user_info.sec_uid`
- 处罚信息：`body.user_info.punish_remind_info`
- 辅助封禁字段：`body.user_info.is_ban`

根据 2026-07-27 验证的三个真实样例，状态映射按以下优先级执行：

1. `punish_remind_info.is_punish === true` 且 `ban_type === 1`：封禁
2. `punish_remind_info.is_punish === true` 且 `ban_type === 2`：违规
3. 没有处罚信息且 `is_ban === false`：正常
4. 出现其他 `ban_type`、字段缺失、外层状态非 200、内层 `status_code` 非 0 或无法解析：检测失败，不猜测账号状态

新增账号时，管理员填写抖音号后主动点击“检测”，系统获取 `sec_uid` 和账号状态并展示结果；检测成功后才能保存。编辑抖音号时必须重新检测。列表提供单条“重新检测”和批量“重新检测状态”，检测成功后同步更新 `sec_uid`、账号状态和最后检测时间。

第三方 API 仅由服务端调用。单次请求超时 10 秒，网络错误最多重试 1 次。检测失败时保留数据库中最近一次成功值并显示“检测失败”提示，不把失败自动判定为正常、违规或封禁。

## 3. 新增与编辑

新增和编辑使用右侧抽屉，避免离开列表上下文。

表单字段：

- 抖音号：必填，去除首尾空格，在数据库中唯一
- `sec_uid`：只读，由抖音号检测 API 获取，在数据库中唯一
- 注册时间：必填，按日期保存
- OP 名称：选填，最多 100 个字符
- OP 卡密：必填
- OP 到期时间：只读，按 OP 卡密最后一个 `|` 分隔符后的 10 位 Unix 秒级时间戳计算，再往后推 60 天
- 归属人：必填
- 售卖状态：必填，新增时默认为“未售卖”
- 账号状态：只读，由抖音号检测 API 判定
- 备注：选填，最多 1000 个字符

OP 到期时间的计算规则：

1. 使用最后一个 `|` 切分 OP 卡密
2. 最后一段必须匹配 10 位数字 Unix 秒级时间戳
3. 将时间戳解析为 UTC 时间点
4. 增加 5,184,000 秒，即固定 60 × 24 小时
5. 数据库以 UTC `Date` 保存，界面按 `Asia/Shanghai` 显示为 `YYYY-MM-DD HH:mm:ss`

例如时间戳 `1782303418` 对应北京时间 `2026-06-24 20:16:58`，计算后的 OP 到期时间为 `2026-08-23 20:16:58`。新增、编辑和导入均由服务端重新计算，不能相信浏览器或导入文件提供的到期时间。时间戳缺失、不是 10 位整数或超出有效日期范围时禁止保存，并指出 OP 卡密格式错误。

表单提交后保留当前搜索、筛选和页码，并刷新受影响的统计与表格数据。服务端唯一索引冲突时，明确指出是抖音号或 `sec_uid` 重复。

## 4. 批量操作

列表支持勾选当前页记录，提供：

- 批量修改售卖状态
- 批量重新检测账号状态
- 批量修改归属人
- 批量删除

账号状态不能手工修改。批量重新检测逐条调用第三方 API，并限制并发量，避免压垮第三方服务。批量删除必须显示影响条数并二次确认。批量修改只更新用户明确选择的字段，不能覆盖其他字段。

## 5. 导入与导出

### 5.1 导入

支持 `.xlsx`、`.xls` 和 `.csv`。页面提供模板下载，模板只包含管理员需要填写的字段：

`抖音号`、`注册时间`、`OP名称`、`OP卡密`、`归属人`、`售卖状态`、`备注`

导入流程：

1. 上传文件并解析表头
2. 展示总行数和前几行预览
3. 校验必填项、日期格式、售卖状态值、OP 到期时间和文件内重复项
4. 按抖音号调用检测 API，取得 `sec_uid` 与账号状态；检测失败的行进入失败明细
5. 检查数据库中已有的抖音号与 `sec_uid`
6. 让管理员选择“跳过重复记录”或“以导入内容更新已有记录”
7. 二次确认后执行导入
8. 返回新增、更新、跳过和失败数量
9. 失败明细可下载

单次导入最多 10,000 行，文件最大 10 MB。导入采用分批写入，避免一次性占用过多内存。

### 5.2 导出

支持导出 `.xlsx` 和 `.csv`。默认导出当前搜索与筛选条件下的全部结果，而不是只导出当前页；如果管理员勾选了记录，则优先导出已勾选记录。

导出文件包含全部业务字段。由于后台只有受信任管理员，OP 卡密会随导出文件完整导出；导出操作写入操作日志。

## 6. 登录与安全

系统只有一个管理员，不提供管理员注册、邀请或多用户管理。

- 管理员用户名和密码从 Docker 环境变量读取
- 服务启动时校验必要环境变量，缺失时拒绝启动
- 密码不写入源码、镜像或 MongoDB
- 登录成功后使用带签名的 HttpOnly、SameSite Cookie 保存会话
- 生产环境 Cookie 启用 Secure
- 会话有固定过期时间，退出后立即失效
- 登录接口按 IP 和用户名限流
- 所有管理 API 均校验会话
- API 设置请求体大小限制、字段白名单和统一输入校验
- OP 卡密在数据库中使用服务端密钥进行字段级加密，API 仅在明确查看、复制、编辑或导出时解密
- 日志不记录管理员密码、会话令牌、完整 OP 卡密或完整 `sec_uid`

## 7. 数据模型

### 7.1 Account

```text
douyinId        string, required, unique
secUid          string, required, unique
registeredAt    date, required
opName          string, optional, max 100
opSecret        encrypted string, required
opExpiresAt     date, required
owner           string, required
saleStatus      enum: unsold | sold | disabled | recovered
accountStatus   enum: normal | violation | banned
accountCheckedAt date, required
remark          string, max 1000
createdAt       date
updatedAt       date
```

索引：

- `douyinId` 唯一索引
- `secUid` 唯一索引
- `saleStatus`
- `accountStatus`
- `registeredAt`
- `owner`
- 用于关键词查询的标准化搜索字段

### 7.2 ImportJob

记录文件名、文件类型、重复处理策略、总行数、新增数、更新数、跳过数、失败数、错误摘要、开始时间、结束时间和结果状态。原始上传文件不长期保存在容器内。

### 7.3 AuditLog

记录操作类型、目标记录、影响数量、变更字段摘要、请求 IP、User-Agent 和时间。日志不保存敏感字段原值。

## 8. API 设计

接口统一使用 `/api` 前缀。

### 8.1 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

### 8.2 账号

- `GET /api/accounts`
- `GET /api/accounts/:id`
- `POST /api/accounts`
- `PATCH /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/batch-update`
- `POST /api/accounts/batch-delete`
- `POST /api/accounts/:id/reveal-secret`
- `POST /api/accounts/check-douyin`
- `POST /api/accounts/:id/recheck`
- `POST /api/accounts/batch-recheck`

列表接口负责服务端分页、搜索、筛选和排序，不把全部数据下载到浏览器后再处理。

### 8.3 导入导出

- `GET /api/imports/template`
- `POST /api/imports/preview`
- `POST /api/imports/execute`
- `GET /api/imports`
- `GET /api/imports/:id/errors`
- `GET /api/exports/accounts`

### 8.4 日志与设置

- `GET /api/audit-logs`
- `GET /api/settings`
- `PATCH /api/settings`

首期设置只包含每页默认数量、会话有效期等非凭据配置。管理员用户名、密码、加密密钥仍只通过环境变量维护。

## 9. 技术架构

采用单仓库三层结构：

- 前端：React + TypeScript + Vite
- API：Node.js + TypeScript + Express
- 数据库：MongoDB + Mongoose

前端使用组件化结构，页面、表格、筛选工具栏、表单抽屉、导入流程和通用状态标签分别维护。数据请求使用统一 API 客户端和查询缓存；表单和导入校验在前后端共享同一套枚举与字段规则，服务端始终是最终校验来源。

生产部署使用：

- `web` 容器：Nginx 提供静态前端并反向代理 `/api`
- `api` 容器：Express API
- `mongo` 容器：MongoDB

只有 `web` 对宿主机暴露端口。`api` 和 `mongo` 仅在 Docker 内部网络可访问。MongoDB 使用命名卷持久化数据，并启用用户名密码认证。

## 10. Docker 与配置

仓库提供：

- 前端多阶段构建 Dockerfile
- API 多阶段构建 Dockerfile
- `docker-compose.yml`
- `.env.example`
- Nginx 配置
- MongoDB 健康检查
- API 健康检查

必要环境变量：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
SESSION_SECRET
FIELD_ENCRYPTION_KEY
MONGO_ROOT_USERNAME
MONGO_ROOT_PASSWORD
MONGO_DATABASE
DOUYIN_CHECK_API_URL
```

首次部署流程为：复制 `.env.example`、填写强密码和随机密钥、运行 `docker compose up -d --build`。升级容器不得删除 MongoDB 数据卷。

## 11. 错误与反馈

- 表单字段错误显示在对应字段下方
- 网络错误、权限失效和服务端错误使用明确提示，不只显示“操作失败”
- 会话失效后返回登录页，并在重新登录后回到原页面
- 删除、批量操作和导入结果显示成功与失败数量
- 导入失败明细提供具体行号、字段和原因
- 空列表区分“尚无数据”和“当前筛选无结果”

## 12. 验收标准

### 功能

- 未登录无法访问管理页面或任一管理 API
- 管理员能登录、退出，并在有效期内保持会话
- 管理员填写的字段可新增和编辑，派生字段可展示、搜索或筛选
- 抖音号和 `sec_uid` 重复会被数据库与 API 拒绝
- 售卖状态可手工修改，账号状态只能通过检测 API 更新，两组状态独立保存
- 三个已提供的真实样例分别映射为正常、封禁和违规
- 第三方检测失败不会覆盖最近一次成功的 `sec_uid` 与账号状态
- OP 卡密默认隐藏，按需查看、复制和导出
- OP 到期时间由卡密时间自动计算，不能手工修改
- Excel/CSV 能预览、校验、导入并下载错误明细
- 导出遵守当前筛选或已勾选范围
- 删除和敏感操作写入审计日志

### 部署

- 全新环境通过一条 Docker Compose 命令启动
- 重启或重建容器后 MongoDB 数据仍存在
- 宿主机不能直接访问 API 容器和 MongoDB 端口
- 健康检查能区分前端、API 和数据库故障

### 界面

- 桌面端保持已确认的紧凑侧边栏和高密度表格
- 1280px 宽度下主要工具栏不重叠
- 窄屏可完成登录、筛选、新增、编辑和导入
- 宽表格使用横向滚动，列顺序不变
- 状态颜色同时配有文字，不只依赖颜色表达
- 表单、菜单、抽屉和确认框支持键盘操作与清晰焦点

## 13. 首期范围外

- 多管理员、角色和权限系统
- 抖音平台接口自动同步
- 自动检测账号违规或封禁状态
- 自动售卖、支付或订单系统
- 对象存储和长期保留原始导入文件
- 多租户与不同团队间数据隔离
