# 公开 APK 同源下载设计

## 目标

让任何访问 `op.tztright.qzz.io` 的用户无需登录即可下载指定 APK。下载必须使用当前公开页面所在域名，不引入跨域请求或额外对象存储。

源文件为 `/Users/edking/Downloads/短位op修复.apk`。当前确认的文件信息：

- 大小：881,585 字节
- SHA-256：`04b2b747ee36eb9891cc64bff8e135431b2bf39daa8692d4d1f8a0bd8f8c36cd`

## 对外接口

- 页面入口：现有公开短 OP 页面 `https://op.tztright.qzz.io/`
- 下载地址：`https://op.tztright.qzz.io/downloads/short-op.apk`
- 页面使用相对链接 `/downloads/short-op.apk`，确保开发、测试和生产环境都从当前来源下载。
- 浏览器下载文件名：`短位op修复.apk`
- 允许方法：`GET`、`HEAD`
- 无需管理员会话或其他认证。

## 架构与文件流

APK 作为 Web 应用的受控静态资源存放在 `apps/web/public/downloads/short-op.apk`。Vite 构建时将其原样复制到 `dist/downloads/short-op.apk`，Web 容器中的 Nginx 直接返回该文件，不经过 Node API。

生产请求路径如下：

1. 用户打开公开短 OP 页面。
2. 页面显示“下载 APK”按钮，链接使用 `/downloads/short-op.apk`。
3. 公开域名的外层 Nginx 精确匹配此路径，并代理到现有 Web 容器的同一路径。
4. 容器内 Nginx 精确匹配此路径并返回构建产物中的 APK。
5. 浏览器按照响应头将文件保存为 `短位op修复.apk`。

外层 Nginx 只新增这一条精确允许规则。现有公开域名对其他 `/api/` 路径和未知页面的 `404` 边界保持不变。

## 页面改动

生产公开域名当前实际使用 `apps/web/public/op.html`，因此下载按钮必须加入该静态页面。React 的 `ShortOpPage` 也加入同一按钮，保证开发环境、组件测试和备用路由的行为一致。

按钮仅发起普通浏览器导航下载，不使用 `fetch`、Blob URL 或 JavaScript 跨域逻辑。

## HTTP 与安全行为

容器内 Nginx 返回 APK 时设置：

- `Content-Type: application/vnd.android.package-archive`
- `Content-Disposition: attachment; filename="short-op.apk"; filename*=UTF-8''%E7%9F%AD%E4%BD%8Dop%E4%BF%AE%E5%A4%8D.apk`
- `X-Content-Type-Options: nosniff`
- 合理的静态缓存响应头

除 `GET`、`HEAD` 外的方法返回 `405`。请求路径固定，不接受用户提供的文件名或磁盘路径，因此不产生目录穿越或任意文件下载入口。

## 错误处理

- 构建产物缺少 APK 时，容器内 Nginx 返回 `404`。
- 外层路由没有匹配精确下载路径时继续按现有公开域名规则返回 `404`。
- 页面不伪造下载成功状态；网络失败由浏览器原生下载行为呈现。

## 测试与验收

实现采用测试先行，至少覆盖：

1. 静态公开页面和 React 页面都使用相对同源下载链接。
2. 容器内 Nginx 只为固定 APK 路径提供下载，并包含所需响应头和方法限制。
3. 部署脚本生成的公开域名 Nginx 配置精确放行 APK，且不放宽其他公开路由。
4. Web 构建后存在 `dist/downloads/short-op.apk`。
5. 源文件、仓库静态文件和构建产物的 SHA-256 完全一致。
6. 完整运行相关测试、类型检查和 Web 构建。
7. 若本地 Docker 环境可用，通过实际 HTTP `GET` 和 `HEAD` 验证状态码、响应头、下载字节数与哈希。

本地构建和 Docker 验证不能证明生产服务器已经更新。只有完成实际部署并从 `https://op.tztright.qzz.io/downloads/short-op.apk` 获取匹配哈希后，才能声称公网下载已上线。
