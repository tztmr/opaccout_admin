# OP Android 离线授权壳

这是账号管理项目的 Android 离线基线，包名和 application ID 固定为
`com.tencent.mobileqq`，QQ 授权入口为 `com.tencent.open.agent.AgentActivity`。

完整 OP 输入使用 `openid|access_token|pay_token` 起始的 3 到 5 个非空字段；在无
网络、无短 OP API 的情况下，本地生成与服务端兼容的二进制 plist 唤醒链接。游戏通过
`AgentActivity` 调起时，成功结果按 QQ 回调协议放在 `key_response`，并从中使用完整
OP 的字段。该离线基线不声明 `INTERNET` 权限、不记录或持久化 OP。

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
./gradlew --offline testDebugUnitTest assembleDebug
```

调试 APK 输出是 `app/build/outputs/apk/debug/app-debug.apk`。该文件是构建产物，不会
随本 Task 提交；9 位短 OP 的联网解析和 `INTERNET` 权限属于后续 Task。
