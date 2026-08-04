# OP Android 双模式授权壳

这是账号管理项目的 Android 离线基线，包名和 application ID 固定为
`com.tencent.mobileqq`，QQ 授权入口为 `com.tencent.open.agent.AgentActivity`。

完整 OP 输入使用 `openid|access_token|pay_token` 起始的 3 到 5 个非空字段；在无网络
情况下，APK 本地生成与服务端兼容的二进制 plist 唤醒链接。输入恰好匹配
`^[1-9][0-9]{8}$` 时，它会联网调用 `https://op.tztright.qzz.io/api/op/resolve` 解析短
OP。游戏通过 `AgentActivity` 调起时，成功结果按 QQ 回调协议放在 `key_response`：完整
OP 直接使用本地输入，短 OP 使用解析响应中的 `opData`。独立启动时，完整 OP 本地生成
唤醒链接，短 OP 使用响应中的 `wakeUrl`。

应用声明 `android.permission.INTERNET`，但不允许明文流量（`usesCleartextTraffic=false`）。
短 OP 请求只接受 HTTPS，连接和读取超时均为 8 秒；不会记录、持久化或复制 OP/解析响应。
短 OP 解析失败不会向游戏返回空授权结果。

这里的“兼容”指生成的 bplist 可由 `NSKeyedArchiver` 解析为与服务端 `op-wake-url`
相同的对象图和字段语义（包括五段 OP 字段、过期字段和回调常量），而非要求不同实现
产出逐字节完全相同的序列化结果。

## 要求与构建

- Java 源/目标版本：17
- compileSdk / targetSdk：34
- minSdk：24
- Gradle：9.3.1（wrapper）

本机需要用未提交的 `local.properties` 指向 Android SDK：

```properties
sdk.dir=/path/to/Android/sdk
```

只使用本机已缓存的依赖执行：

```bash
cd android-app
./gradlew --offline testDebugUnitTest assembleDebug \
  -PopApiBaseUrl=https://op.tztright.qzz.io
```

默认 API 基址是 `https://op.tztright.qzz.io`。调试时可通过 `-PopApiBaseUrl` 覆盖为另一个
绝对 HTTPS 基址；`http://...`、携带 query 或 fragment 的地址会在 Gradle 配置阶段被拒绝。

调试 APK 输出是 `app/build/outputs/apk/debug/app-debug.apk`；仓库交付副本为
`../apks/tkacc-short-op-debug.apk`。本地编译和静态清单检查不等同于真实公开 API、SSL、
设备安装或游戏回调验证；联调必须使用虚构数据，且不要记录真实 OP 或短码。
