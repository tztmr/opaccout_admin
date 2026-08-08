# OP APK 原版 UI 对齐与兼容性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 Android APK 调整为参考工程的蓝白原生 UI，保留 9 位短 OP 与完整 OP 双模式，并修复 Android 7.0 兼容和覆盖安装问题。

**Architecture:** 视觉资源与 Activity 行为分开修改：XML 负责原版风格布局和弹窗，当前 Java 业务类继续负责短码解析、完整 OP 编码和授权回调。所有异步结果通过现有请求门控进入统一成功弹窗；API 24 兼容修复使用项目内实现和旧版 Java API，不增加网络依赖或提高 `minSdk`。

**Tech Stack:** Android Gradle Plugin 9.1、Gradle 9.3.1、Java 17、Android SDK 34、原生 Android XML/Activity、ADB、aapt2、apksigner。

## Approved Execution Adjustment

用户于 2026-08-08 明确批准在当前 `main` checkout 中保留现有改动并直接实施，同时批准 UI XML 使用资源编译、Lint 和真机截图验收。执行时以下调整覆盖后文的旧静态契约步骤：

- 不创建 `UiResourceContractTest.java` 或 `MainActivitySourceContractTest.java`；测试规则禁止把源码/XML 文本搜索当成行为测试。
- UI XML 与 drawable 作为配置资源，使用 `processDebugResources`、`lintDebug` 和设备截图验证。
- `MainActivity` 行为先创建 `android-app/app/src/androidTest/java/com/tencent/mobileqq/MainActivityInstrumentedTest.java`，使用平台 `InstrumentationTestRunner` 和 `UiAutomation` 验证游戏授权模式提交虚构完整 OP 后显示不含敏感值的成功弹窗；先在旧 Activity 上运行并观察失败，再实现弹窗接线并观察通过。
- QA Instrumentation 构建固定使用 `-PapplicationIdOverride=com.edking.tkacc.opqa`，避免覆盖设备上的原版包。

## Global Constraints

- 最低系统版本保持 `minSdk 24`，不通过提高最低版本规避 Lint 错误。
- 正式 application ID 默认保持 `com.tencent.mobileqq`；仅设备 QA 构建使用 `com.edking.tkacc.opqa`。
- 正式版本设置为 `versionCode 2600`、`versionName 9.0.1`。
- 默认短 OP API 基址保持 `https://op.tztright.qzz.io`，只允许 HTTPS Gradle 覆盖地址。
- 完整 OP 继续纯本地处理；9 位短 OP 继续通过当前公开 API 解析。
- 不添加假延时，不显示或记录完整 OP、Token、唤醒 URL。
- 不提高短 OP API 权限，不修改服务端、Web 或账号数据。
- 不覆盖 `apks/短位op.apk`、`.DS_Store` 或其他无关用户文件。
- 最终产物写入 `apks/tkacc-short-op-debug.apk`。
- 每次提交只包含当前任务文件；提交前运行 `git diff --check` 并检查暂存范围。

---

## File Responsibility Map

### Create

- `android-app/app/src/androidTest/java/com/tencent/mobileqq/MainActivityInstrumentedTest.java`：在真实 Android UI 中验证成功弹窗和敏感数据不展示。
- `android-app/app/src/main/res/layout/dialog_loading.xml`：真实处理过程的原版风格加载弹窗。
- `android-app/app/src/main/res/layout/dialog_success.xml`：不展示 Token 的原版风格成功弹窗。
- `android-app/app/src/main/res/drawable/ic_op_logo.xml`：主页面盾牌 OP Logo。
- `android-app/app/src/main/res/drawable/bg_button_blue.xml`：蓝色圆角主按钮。
- `android-app/app/src/main/res/drawable/bg_notification.xml`：状态提示卡背景。
- `android-app/app/src/main/res/drawable/bg_edittext.xml`：输入框背景。
- `android-app/app/src/main/res/drawable/bg_dialog.xml`：弹窗背景。
- `android-app/app/src/main/res/drawable/bg_success_icon.xml`：成功勾选图标背景。
- `android-app/app/src/main/res/drawable/bg_secure_summary.xml`：成功弹窗的非敏感说明卡。
- `android-app/app/src/main/res/xml/backup_rules.xml`：Android 11 及以下禁止备份规则。
- `android-app/app/src/main/res/xml/data_extraction_rules.xml`：Android 12 及以上禁止云备份和设备迁移规则。
- `android-app/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml`：包含 monochrome 层的 Android 13 图标。
- `android-app/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml`：包含 monochrome 层的 Android 13 圆形图标。

### Modify

- `android-app/app/src/main/java/com/tencent/mobileqq/OpWakeUrlBuilder.java`：改用 API 24 可用的 Base64、URL 编码和字节输出实现。
- `android-app/app/src/main/java/com/tencent/mobileqq/ShortOpApiClient.java`：改用 API 24 可用的 ISO 时间和 UTF-8 响应解析。
- `android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java`：接入真实加载/成功弹窗和生命周期清理。
- `android-app/app/src/test/java/com/tencent/mobileqq/OpWakeUrlBuilderTest.java`：补 Base64 边界和编码回归测试。
- `android-app/app/src/test/java/com/tencent/mobileqq/ShortOpApiClientTest.java`：补严格 ISO 时间回归测试。
- `android-app/app/src/main/res/layout/activity_main.xml`：替换为原版风格、保留当前控件 ID。
- `android-app/app/src/main/res/values/strings.xml`：集中管理页面、弹窗和错误文本。
- `android-app/app/src/main/res/values/colors.xml`：集中管理背景、主色和状态色。
- `android-app/app/src/main/res/values/themes.xml`：使用原版浅色无标题栏主题。
- `android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`：使用白底 OP 图标。
- `android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`：使用白底 OP 圆形图标。
- `android-app/app/src/main/AndroidManifest.xml`：增加数据提取规则并使用完全限定 Activity 类名支持 QA application ID。
- `android-app/app/build.gradle`：版本升级、QA application ID 覆盖和 UI 契约测试任务。
- `android-app/README.md`：记录 SDK 环境、正式/QA 构建和产物检查命令。
- `apks/tkacc-short-op-debug.apk`：最终构建产物。

---

### Task 1: 修复 API 24 兼容性并恢复可升级版本

**Files:**
- Modify: `android-app/app/src/main/java/com/tencent/mobileqq/OpWakeUrlBuilder.java`
- Modify: `android-app/app/src/main/java/com/tencent/mobileqq/ShortOpApiClient.java`
- Modify: `android-app/app/src/test/java/com/tencent/mobileqq/OpWakeUrlBuilderTest.java`
- Modify: `android-app/app/src/test/java/com/tencent/mobileqq/ShortOpApiClientTest.java`
- Modify: `android-app/app/build.gradle`

**Interfaces:**
- Consumes: `OpWakeUrlBuilder.build(String opData, String appId)`、`ShortOpApiClient.parse(int status, String body)`。
- Produces: `OpWakeUrlBuilder.encodeBase64(byte[] value)`、`ShortOpApiClient.isStrictIsoInstant(String value)`，以及可覆盖的 Gradle 属性 `applicationIdOverride`。

- [ ] **Step 1: 记录当前 Lint 失败基线**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon lintDebug
```

Expected: FAIL，报告 20 个 `NewApi` 错误；首个错误为 `java.util.Base64#getEncoder` 需要 API 26。

- [ ] **Step 2: 为 Base64 填充边界写回归测试**

在 `OpWakeUrlBuilderTest.main` 调用：

```java
matchesStandardBase64AcrossPaddingBoundaries();
```

新增：

```java
private static void matchesStandardBase64AcrossPaddingBoundaries() {
    byte[][] fixtures = {
        new byte[] {},
        new byte[] { 0 },
        new byte[] { 0, 1 },
        new byte[] { 0, 1, 2 },
        new byte[] { 0, 1, 2, (byte) 0xFF }
    };
    for (byte[] fixture : fixtures) {
        requireEquals(
            Base64.getEncoder().encodeToString(fixture),
            OpWakeUrlBuilder.encodeBase64(fixture),
            "API 24 encoder must match standard Base64"
        );
    }
}
```

- [ ] **Step 3: 为严格 ISO 时间写回归测试**

在 `ShortOpApiClientTest.main` 调用：

```java
acceptsOnlyServerIsoInstantShape();
```

新增：

```java
private static void acceptsOnlyServerIsoInstantShape() {
    require(ShortOpApiClient.isStrictIsoInstant("2026-08-23T12:16:58.000Z"), "server ISO timestamp must pass");
    require(!ShortOpApiClient.isStrictIsoInstant("2026-02-30T12:16:58.000Z"), "invalid calendar date must fail");
    require(!ShortOpApiClient.isStrictIsoInstant("2026-08-23T12:16:58Z"), "missing milliseconds must fail");
    require(!ShortOpApiClient.isStrictIsoInstant("2026-08-23 12:16:58.000Z"), "non-ISO separator must fail");
}
```

- [ ] **Step 4: 运行契约测试并确认新方法尚不存在**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest
```

Expected: FAIL，Java 编译提示 `encodeBase64` 或 `isStrictIsoInstant` 不存在。

- [ ] **Step 5: 实现不依赖高版本 API 的 Base64 与字节追加**

在 `OpWakeUrlBuilder` 增加标准 Base64 字符表及以下包级方法：

```java
private static final char[] BASE64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

static String encodeBase64(byte[] value) {
    StringBuilder encoded = new StringBuilder(((value.length + 2) / 3) * 4);
    for (int index = 0; index < value.length; index += 3) {
        int first = value[index] & 0xFF;
        int second = index + 1 < value.length ? value[index + 1] & 0xFF : 0;
        int third = index + 2 < value.length ? value[index + 2] & 0xFF : 0;
        encoded.append(BASE64[first >>> 2]);
        encoded.append(BASE64[((first & 0x03) << 4) | (second >>> 4)]);
        encoded.append(index + 1 < value.length ? BASE64[((second & 0x0F) << 2) | (third >>> 6)] : '=');
        encoded.append(index + 2 < value.length ? BASE64[third & 0x3F] : '=');
    }
    return encoded.toString();
}

private static void append(ByteArrayOutputStream output, byte[] value) {
    output.write(value, 0, value.length);
}
```

将生产代码中的 `Base64.getEncoder().encodeToString(...)` 改为 `encodeBase64(...)`，所有 `writeBytes(value)` 改为 `append(output, value)`。URL 编码使用 Android 7 可用的签名：

```java
private static String urlEncode(String value) {
    try {
        return URLEncoder.encode(value, "UTF-8");
    } catch (UnsupportedEncodingException impossible) {
        throw new AssertionError(impossible);
    }
}
```

- [ ] **Step 6: 实现 API 24 可用的严格 ISO 时间解析**

在 `ShortOpApiClient` 中移除 `java.time` 导入，新增：

```java
static boolean isStrictIsoInstant(String value) {
    if (value == null || !value.matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")) return false;
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
    format.setLenient(false);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    ParsePosition position = new ParsePosition(0);
    Date parsed = format.parse(value, position);
    return parsed != null && position.getIndex() == value.length();
}
```

以 `isStrictIsoInstant(expiresAt)` 取代 `Instant.parse`，并将响应读取结果改为：

```java
return new String(output.toByteArray(), StandardCharsets.UTF_8);
```

- [ ] **Step 7: 设置升级版本与安全 QA application ID 覆盖**

在 `app/build.gradle` 顶部增加：

```groovy
def applicationIdOverride = providers.gradleProperty('applicationIdOverride')
    .getOrElse('com.tencent.mobileqq')
    .trim()

if (!(applicationIdOverride ==~ '^[a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z][a-zA-Z0-9_]*)+$')) {
    throw new GradleException('applicationIdOverride must be a valid Java-style application ID')
}
```

并更新 `defaultConfig`：

```groovy
applicationId applicationIdOverride
versionCode 2600
versionName '9.0.1'
```

- [ ] **Step 8: 运行契约测试与 Lint**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest lintDebug
```

Expected: 两个契约测试输出通过；20 个 `NewApi` 错误全部消失。此时允许尚未处理的资源/Manifest 警告存在。

- [ ] **Step 9: 提交兼容性修复**

```bash
git add android-app/app/build.gradle \
  android-app/app/src/main/java/com/tencent/mobileqq/OpWakeUrlBuilder.java \
  android-app/app/src/main/java/com/tencent/mobileqq/ShortOpApiClient.java \
  android-app/app/src/test/java/com/tencent/mobileqq/OpWakeUrlBuilderTest.java \
  android-app/app/src/test/java/com/tencent/mobileqq/ShortOpApiClientTest.java
git diff --cached --check
git commit -m "fix: support APK runtime from Android 7"
```

---

### Task 2: 建立并实现原版风格 UI 资源契约

**Files:**
- Create: `android-app/app/src/test/java/com/tencent/mobileqq/UiResourceContractTest.java`
- Create: `android-app/app/src/main/res/layout/dialog_loading.xml`
- Create: `android-app/app/src/main/res/layout/dialog_success.xml`
- Create: `android-app/app/src/main/res/drawable/ic_op_logo.xml`
- Create: `android-app/app/src/main/res/drawable/bg_button_blue.xml`
- Create: `android-app/app/src/main/res/drawable/bg_notification.xml`
- Create: `android-app/app/src/main/res/drawable/bg_edittext.xml`
- Create: `android-app/app/src/main/res/drawable/bg_dialog.xml`
- Create: `android-app/app/src/main/res/drawable/bg_success_icon.xml`
- Create: `android-app/app/src/main/res/drawable/bg_secure_summary.xml`
- Modify: `android-app/app/src/main/res/layout/activity_main.xml`
- Modify: `android-app/app/src/main/res/values/strings.xml`
- Modify: `android-app/app/src/main/res/values/colors.xml`
- Modify: `android-app/app/src/main/res/values/themes.xml`
- Modify: `android-app/app/build.gradle`

**Interfaces:**
- Consumes: current IDs `R.id.op_data_input`、`R.id.status`、`R.id.submit`。
- Produces: `R.layout.dialog_loading`、`R.layout.dialog_success`、`R.id.loading_message`、`R.id.success_message`、`R.id.success_confirm`。

- [ ] **Step 1: 写 UI 资源失败契约**

新增 `UiResourceContractTest.java`：

```java
package com.tencent.mobileqq;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class UiResourceContractTest {
    public static void main(String[] args) throws Exception {
        File resources = new File(System.getProperty("oplogin.resources.dir"));
        String activity = read(new File(resources, "layout/activity_main.xml"));
        String loading = read(new File(resources, "layout/dialog_loading.xml"));
        String success = read(new File(resources, "layout/dialog_success.xml"));
        String strings = read(new File(resources, "values/strings.xml"));

        require(activity.contains("@drawable/ic_op_logo"), "main page must show the OP shield logo");
        require(activity.contains("@drawable/bg_notification"), "status must use the original card style");
        require(activity.contains("@drawable/bg_edittext"), "input must use the original rounded style");
        require(activity.contains("@drawable/bg_button_blue"), "submit must use the original blue button");
        require(activity.contains("@+id/op_data_input"), "current input ID must be preserved");
        require(activity.contains("@+id/status"), "current status ID must be preserved");
        require(activity.contains("@+id/submit"), "current submit ID must be preserved");
        require(loading.contains("@+id/loading_message"), "loading dialog must expose status text");
        require(success.contains("@+id/success_message"), "success dialog must expose safe summary text");
        require(success.contains("@+id/success_confirm"), "success dialog must expose confirm action");
        require(!success.toLowerCase().contains("token"), "success dialog must not expose Token");
        require(!strings.toLowerCase().contains("token:"), "strings must not expose Token snippets");
        System.out.println("Original-style UI resource contract passed");
    }

    private static String read(File file) throws Exception {
        StringBuilder content = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
            new FileInputStream(file), StandardCharsets.UTF_8
        ))) {
            char[] buffer = new char[2048];
            int count;
            while ((count = reader.read(buffer)) != -1) content.append(buffer, 0, count);
        }
        return content.toString();
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
```

- [ ] **Step 2: 注册 UI 契约任务并确认失败**

在 `app/build.gradle` 增加：

```groovy
tasks.register('runUiResourceContract', JavaExec) {
    dependsOn 'compileDebugUnitTestJavaWithJavac'
    classpath = files(
        layout.buildDirectory.dir('intermediates/javac/debugUnitTest/compileDebugUnitTestJavaWithJavac/classes'),
        layout.buildDirectory.dir('intermediates/javac/debug/compileDebugJavaWithJavac/classes')
    )
    mainClass = 'com.tencent.mobileqq.UiResourceContractTest'
    systemProperty 'oplogin.resources.dir', file('src/main/res').absolutePath
}
```

把 `runUiResourceContract` 加入 `testDebugUnitTest.dependsOn`，然后运行：

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest
```

Expected: FAIL，首先报告 `dialog_loading.xml` 不存在或主页面缺少 `ic_op_logo`。

- [ ] **Step 3: 移植原版视觉资源**

从参考工程的同名资源逐文件移植并保留内容：

```text
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/ic_op_logo.xml
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/bg_button_blue.xml
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/bg_notification.xml
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/bg_edittext.xml
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/bg_dialog.xml
/Users/edking/Documents/网赚学习/op东鹏转发器/android-app/app/src/main/res/drawable/bg_success_icon.xml
```

`bg_secure_summary.xml` 使用不包含敏感字段的灰色卡片：

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#F7F8FA" />
    <corners android:radius="8dp" />
    <stroke android:width="1dp" android:color="#EBEBEB" />
</shape>
```

- [ ] **Step 4: 实现原版风格主页面**

将 `activity_main.xml` 改为参考截图的 `ScrollView` + 垂直 `LinearLayout`，同时满足以下精确映射：

```xml
<TextView android:id="@+id/status" android:background="@drawable/bg_notification" />
<EditText
    android:id="@+id/op_data_input"
    android:background="@drawable/bg_edittext"
    android:importantForAutofill="noExcludeDescendants"
    android:inputType="textMultiLine|textNoSuggestions" />
<Button
    android:id="@+id/submit"
    android:layout_height="56dp"
    android:background="@drawable/bg_button_blue"
    android:stateListAnimator="@null"
    android:text="@string/submit"
    android:textAllCaps="false" />
```

页面背景使用 `#F7F8FA`，Logo 为 48dp，标题 24sp，状态卡圆角 16dp，输入框高度 160dp，主按钮圆角 28dp；保留滚动能力，不设置固定屏幕高度。

- [ ] **Step 5: 实现加载与成功弹窗 XML**

`dialog_loading.xml` 使用 280dp 宽白色圆角容器、48dp 蓝色 `ProgressBar`、标题“正在授权登录…”和 `@+id/loading_message`。

`dialog_success.xml` 使用 280dp 宽白色圆角容器、绿色圆形勾选图标、标题“成功”、`@+id/success_message` 非敏感说明卡和 `@+id/success_confirm` 蓝色按钮。不得出现 `tv_token`、`Token:`、OP 字段名或剪贴板操作。

- [ ] **Step 6: 更新字符串、颜色和主题**

`strings.xml` 至少定义：

```xml
<string name="app_name">OP 上号器</string>
<string name="title">OP 上号器</string>
<string name="subtitle">安全授权，极速登录</string>
<string name="authorization_request">正在为游戏 (AppID: %1$s) 授权</string>
<string name="standalone_instruction">输入 9 位短 OP 或完整 OP，开始安全授权</string>
<string name="input_title">粘贴 OP 数据</string>
<string name="op_hint">请粘贴 9 位短 OP 或完整 OP 数据</string>
<string name="submit">🛡️ 点击授权登录</string>
<string name="input_mode_notice">🛡️ 完整 OP 仅在本机处理；短 OP 仅通过 HTTPS 解析，不会保存输入</string>
<string name="help_notice">遇到问题？请检查输入或网络后重试</string>
<string name="loading_title">正在授权登录…</string>
<string name="loading_short_op">正在安全解析短 OP</string>
<string name="loading_full_op">正在本机处理完整 OP</string>
<string name="success_title">成功</string>
<string name="success_auth_message">授权数据已安全处理，确认后返回游戏</string>
<string name="success_wake_message">授权链接已安全生成，确认后打开应用</string>
<string name="success_confirm">确定</string>
```

`colors.xml` 定义 `surface=#F7F8FA`、`primary=#1E6FFF`、`text_primary=#333333`、`text_secondary=#999999`、`icon_background=#FFFFFF`。主题保持 `Theme.Material.Light.NoActionBar`，窗口背景使用 `surface`，状态栏使用浅色背景。

- [ ] **Step 7: 运行 UI 契约、资源编译和 Lint**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest processDebugResources lintDebug
```

Expected: `Original-style UI resource contract passed`；资源编译通过；不出现缺失 ID、drawable 或字符串错误。

- [ ] **Step 8: 提交 UI 资源**

```bash
git add android-app/app/build.gradle \
  android-app/app/src/test/java/com/tencent/mobileqq/UiResourceContractTest.java \
  android-app/app/src/main/res/layout/activity_main.xml \
  android-app/app/src/main/res/layout/dialog_loading.xml \
  android-app/app/src/main/res/layout/dialog_success.xml \
  android-app/app/src/main/res/drawable \
  android-app/app/src/main/res/values/strings.xml \
  android-app/app/src/main/res/values/colors.xml \
  android-app/app/src/main/res/values/themes.xml
git diff --cached --check
git commit -m "feat: align APK UI with original layout"
```

---

### Task 3: 把原版弹窗接入真实授权流程

**Files:**
- Create: `android-app/app/src/test/java/com/tencent/mobileqq/MainActivitySourceContractTest.java`
- Modify: `android-app/app/build.gradle`
- Modify: `android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java`

**Interfaces:**
- Consumes: `R.layout.dialog_loading`、`R.layout.dialog_success`、`R.id.loading_message`、`R.id.success_message`、`R.id.success_confirm`。
- Produces: `showLoading(boolean shortOp)`、`hideLoading()`、`showSuccess(String opData, String wakeUrl, boolean authRequest)`、`dismissDialogs()`。

- [ ] **Step 1: 写 MainActivity 行为接线失败契约**

新增 `MainActivitySourceContractTest.java`：

```java
package com.tencent.mobileqq;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class MainActivitySourceContractTest {
    public static void main(String[] args) throws Exception {
        String source = read(new File(System.getProperty("oplogin.main.activity")));
        require(source.contains("R.layout.dialog_loading"), "activity must use the loading dialog");
        require(source.contains("R.layout.dialog_success"), "activity must use the success dialog");
        require(source.contains("showSuccess("), "both authorization modes must converge on success UI");
        require(source.contains("dismissDialogs()"), "activity lifecycle must dismiss dialogs");
        require(!source.contains("postDelayed"), "activity must not fake a loading delay");
        require(!source.contains("setText(opData"), "activity must not display OP data");
        require(!source.contains("setText(wakeUrl"), "activity must not display wake URLs");
        System.out.println("MainActivity dialog wiring contract passed");
    }

    private static String read(File file) throws Exception {
        StringBuilder content = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
            new FileInputStream(file), StandardCharsets.UTF_8
        ))) {
            char[] buffer = new char[2048];
            int count;
            while ((count = reader.read(buffer)) != -1) content.append(buffer, 0, count);
        }
        return content.toString();
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
```

- [ ] **Step 2: 注册行为接线契约并确认失败**

在 `app/build.gradle` 增加 `runMainActivitySourceContract`，classpath 与 `runUiResourceContract` 相同，并设置：

```groovy
mainClass = 'com.tencent.mobileqq.MainActivitySourceContractTest'
systemProperty 'oplogin.main.activity', file('src/main/java/com/tencent/mobileqq/MainActivity.java').absolutePath
```

把任务加入 `testDebugUnitTest.dependsOn`，然后运行：

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest
```

Expected: FAIL，报告 Activity 尚未使用 `R.layout.dialog_loading`。

- [ ] **Step 3: 增加弹窗字段和生命周期清理**

```bash
rg -n 'dialog_loading|dialog_success|showSuccess|hideLoading' android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java
```

Expected: 改动前无匹配；完成本步骤后四类匹配均存在。

在 `MainActivity` 增加：

```java
private AlertDialog loadingDialog;
private AlertDialog successDialog;
```

`onNewIntent` 在更新请求模式前执行：

```java
shortOpRequestGate.cancel();
dismissDialogs();
setIntent(intent);
updateRequestMode(intent);
```

`onDestroy` 在关闭执行器前执行 `dismissDialogs()`，防止窗口泄漏。

- [ ] **Step 4: 用真实加载弹窗替换状态文字加载**

实现：

```java
private void showLoading(boolean shortOp) {
    hideLoading();
    View view = getLayoutInflater().inflate(R.layout.dialog_loading, null);
    TextView message = view.findViewById(R.id.loading_message);
    message.setText(shortOp ? R.string.loading_short_op : R.string.loading_full_op);
    loadingDialog = new AlertDialog.Builder(this)
        .setView(view)
        .setCancelable(false)
        .create();
    loadingDialog.show();
    if (loadingDialog.getWindow() != null) {
        loadingDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
    }
    submitButton.setEnabled(false);
}

private void hideLoading() {
    if (loadingDialog != null) {
        loadingDialog.dismiss();
        loadingDialog = null;
    }
    submitButton.setEnabled(true);
}
```

短 OP 在提交到执行器前调用 `showLoading(true)`；完整 OP 在本地构建前调用 `showLoading(false)`，构建完成或异常时立即 `hideLoading()`，不使用 `Handler.postDelayed`。

- [ ] **Step 5: 实现不泄露敏感数据的成功弹窗**

实现：

```java
private void showSuccess(String opData, String wakeUrl, boolean authRequest) {
    View view = getLayoutInflater().inflate(R.layout.dialog_success, null);
    TextView message = view.findViewById(R.id.success_message);
    message.setText(authRequest ? R.string.success_auth_message : R.string.success_wake_message);
    successDialog = new AlertDialog.Builder(this)
        .setView(view)
        .setCancelable(false)
        .create();
    view.findViewById(R.id.success_confirm).setOnClickListener(ignored -> {
        successDialog.dismiss();
        successDialog = null;
        if (authRequest) {
            Intent result = new Intent();
            result.putExtra("op_data", opData);
            setResult(RESULT_OK, result);
            finish();
        } else {
            openWakeUrl(wakeUrl);
        }
    });
    successDialog.show();
    if (successDialog.getWindow() != null) {
        successDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
    }
}
```

不得把 `opData`、`wakeUrl` 或字段片段传给任何 TextView、Toast 或日志。

- [ ] **Step 6: 统一完整 OP 和短 OP 成功路径**

完整 OP 路径改为：本地 `build` → `hideLoading()` → `showSuccess(opData, wakeUrl, isAuthRequest)`。

短 OP 路径改为：请求成功且 request ID 仍为当前 → `hideLoading()` → `showSuccess(response.opData(), response.wakeUrl(), authRequest)`。

失败路径改为：当前 request ID 有效 → `hideLoading()` → 显示原有失败 Toast。过期请求不得关闭新请求的弹窗。

- [ ] **Step 7: 实现统一弹窗清理**

```java
private void dismissDialogs() {
    hideLoading();
    if (successDialog != null) {
        successDialog.dismiss();
        successDialog = null;
    }
}
```

确保 `hideLoading()` 在 Activity 正在销毁时不尝试恢复已失效视图；必要时仅在 `submitButton != null` 时更新 enabled。

- [ ] **Step 8: 编译、测试和静态敏感信息检查**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest lintDebug assembleDebug
rg -n 'setText\(.*opData|setText\(.*wakeUrl|Log\.|System\.out.*op|tv_token|Token:' app/src/main
```

Expected: Gradle 三项通过；敏感信息搜索没有生产代码匹配。测试类的固定虚构字段不计入生产代码搜索。

- [ ] **Step 9: 提交真实弹窗流程**

```bash
git add android-app/app/build.gradle \
  android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java \
  android-app/app/src/test/java/com/tencent/mobileqq/MainActivitySourceContractTest.java
git diff --cached --check
git commit -m "feat: connect APK dialogs to authorization flow"
```

---

### Task 4: 修复 Manifest、备份和图标警告并补构建文档

**Files:**
- Create: `android-app/app/src/main/res/xml/backup_rules.xml`
- Create: `android-app/app/src/main/res/xml/data_extraction_rules.xml`
- Create: `android-app/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml`
- Create: `android-app/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml`
- Modify: `android-app/app/src/main/AndroidManifest.xml`
- Modify: `android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Modify: `android-app/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Modify: `android-app/README.md`

**Interfaces:**
- Consumes: Gradle 属性 `applicationIdOverride`、现有 `Theme.OpAuthorization`。
- Produces: 完全限定入口 `com.tencent.mobileqq.MainActivity`、禁止备份规则、Android 13 monochrome 图标和可复现构建命令。

- [ ] **Step 1: 写禁止备份规则**

`backup_rules.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
</full-backup-content>
```

`data_extraction_rules.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
```

- [ ] **Step 2: 更新 Manifest 支持 QA application ID 和禁止备份**

应用节点增加：

```xml
android:dataExtractionRules="@xml/data_extraction_rules"
android:fullBackupContent="@xml/backup_rules"
```

将主 Activity 从相对名改为：

```xml
android:name="com.tencent.mobileqq.MainActivity"
```

保留 `android:allowBackup="false"`、`android:usesCleartextTraffic="false"` 和 INTERNET 权限。

- [ ] **Step 3: 添加 Android 13 monochrome 图标覆盖**

保持 v26 图标的白色背景和当前前景，在 `mipmap-anydpi-v33` 的普通/圆形图标中使用：

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

- [ ] **Step 4: 补充 README 构建与 QA 命令**

README 明确：

```bash
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest lintDebug assembleDebug
```

QA 构建命令：

```bash
./gradlew --offline --no-daemon \
  -PapplicationIdOverride=com.edking.tkacc.opqa \
  -PopApiBaseUrl=https://127.0.0.1 \
  assembleDebug
```

说明 QA 包只用于并行安装和无真实凭证验证，正式构建不能传 `applicationIdOverride`。

- [ ] **Step 5: 运行完整静态验证并审查剩余警告**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon testDebugUnitTest lintDebug assembleDebug
sed -n '1,260p' app/build/intermediates/lint_intermediate_text_report/debug/lintReportDebug/lint-results-debug.txt
```

Expected: BUILD SUCCESSFUL、Lint 0 errors。允许保留 `AgentActivity` 竖屏约束警告，但报告必须明确其为授权协议兼容选择；其他可修警告不得静默忽略。

- [ ] **Step 6: 提交 Manifest、图标和文档修复**

```bash
git add android-app/app/src/main/AndroidManifest.xml \
  android-app/app/src/main/res/xml \
  android-app/app/src/main/res/mipmap-anydpi-v26 \
  android-app/app/src/main/res/mipmap-anydpi-v33 \
  android-app/README.md
git diff --cached --check
git commit -m "fix: harden APK manifest and build checks"
```

---

### Task 5: 设备 QA、最终 APK 和交付证据

**Files:**
- Modify: `apks/tkacc-short-op-debug.apk`

**Interfaces:**
- Consumes: `applicationIdOverride`、`opApiBaseUrl`、连接设备序列号 `56be8ea4`。
- Produces: QA 截图、ADB/Logcat 验证结果、最终正式 APK 的哈希与静态元数据。

- [ ] **Step 1: 构建不会访问生产 API 的 QA 包**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon clean \
  -PapplicationIdOverride=com.edking.tkacc.opqa \
  -PopApiBaseUrl=https://127.0.0.1 \
  testDebugUnitTest lintDebug assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk /private/tmp/tkacc-op-qa.apk
```

Expected: BUILD SUCCESSFUL，QA APK 只会把短 OP 请求发往设备自身的 `127.0.0.1`，不会返回真实凭证。

- [ ] **Step 2: 安装并启动 QA 包**

Run:

```bash
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 install -r /private/tmp/tkacc-op-qa.apk
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 shell am start -W \
  -n com.edking.tkacc.opqa/com.tencent.mobileqq.MainActivity
```

Expected: 安装成功；设备上的原版 `com.tencent.mobileqq` 保持安装，QA 页面独立启动。

- [ ] **Step 3: 核对主页面实际渲染**

Run:

```bash
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 exec-out screencap -p \
  > /private/tmp/tkacc-op-qa-main.png
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 shell uiautomator dump /sdcard/tkacc-op-qa.xml
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 pull /sdcard/tkacc-op-qa.xml /private/tmp/tkacc-op-qa.xml
```

Expected: 截图显示蓝白 OP Logo、提示卡、圆角输入框、安全说明和蓝色按钮；UI XML 包含输入、状态和按钮文本，无截断或重叠。

- [ ] **Step 4: 验证空输入、错误完整 OP 和短 OP 离线错误**

通过 `uiautomator dump` 取得控件中心点，再用 ADB 点击/输入：

1. 空输入点击按钮，出现“OP 数据不能为空”。
2. 输入 `bad-fixture`，出现“OP 数据格式不正确”，加载弹窗关闭且按钮恢复。
3. 输入 `123456789`，请求只发往 `https://127.0.0.1`，出现“网络不可用”，不展示 OP 或 Token。

Expected: 三种失败均不崩溃、不停留在加载状态、不打开其他应用。

- [ ] **Step 5: 验证虚构完整 OP 的成功弹窗**

清空输入并输入虚构值：

```text
fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418
```

点击按钮后截图保存为 `/private/tmp/tkacc-op-qa-success.png`。

Expected: 立即完成本地处理并显示成功弹窗；弹窗只显示安全状态，不显示上述任何字段。确认后若设备没有目标处理器，显示“未找到可处理该授权链接的应用”而不崩溃。

- [ ] **Step 6: 验证游戏授权模式**

Run:

```bash
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 shell am force-stop com.edking.tkacc.opqa
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 shell am start -W \
  -n com.edking.tkacc.opqa/com.tencent.mobileqq.MainActivity \
  --ez is_auth_request true --es appid 1105602870
```

输入同一虚构完整 OP 并提交。

Expected: 状态卡显示目标 AppID；成功弹窗确认后 Activity 以 `RESULT_OK` 返回，界面和日志不显示 OP。

- [ ] **Step 7: 检查崩溃、ANR 和敏感日志**

Run:

```bash
/Users/edking/Library/Android/sdk/platform-tools/adb -s 56be8ea4 logcat -d \
  | rg -n 'FATAL EXCEPTION|ANR in com\.edking\.tkacc\.opqa|fixture-openid|fixture-access|pasteboard='
```

Expected: 无匹配。若系统日志包含其他应用历史记录，先按 QA PID 过滤后重新判断。

- [ ] **Step 8: 构建正式 APK 并复制到交付目录**

Run:

```bash
cd android-app
ANDROID_HOME=/Users/edking/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/edking/Library/Android/sdk \
GRADLE_OPTS='-Dorg.gradle.native=false' \
./gradlew --offline --no-daemon clean testDebugUnitTest lintDebug assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../apks/tkacc-short-op-debug.apk
```

Expected: 正式 APK application ID 恢复为 `com.tencent.mobileqq`，API 基址恢复为生产 HTTPS 域名。

- [ ] **Step 9: 检查最终包元数据、签名和哈希**

Run:

```bash
/Users/edking/Library/Android/sdk/build-tools/36.0.0/aapt2 dump badging \
  apks/tkacc-short-op-debug.apk
/Users/edking/Library/Android/sdk/build-tools/36.0.0/apksigner verify --verbose --print-certs \
  apks/tkacc-short-op-debug.apk
shasum -a 256 apks/tkacc-short-op-debug.apk
```

Expected: `package=com.tencent.mobileqq`、`versionCode=2600`、`versionName=9.0.1`、`minSdkVersion=24`、INTERNET 权限、v2 签名验证成功和非空 SHA-256。

- [ ] **Step 10: 最终范围检查并提交 APK**

```bash
git status --short
git diff --check
git add apks/tkacc-short-op-debug.apk
git diff --cached --stat
git commit -m "build: refresh verified short OP APK"
```

Expected: 只暂存最终 APK；`apks/短位op.apk` 和 `.DS_Store` 不进入提交。

---

## Final Verification Checklist

- [ ] `testDebugUnitTest` 输出四个契约测试全部通过。
- [ ] `lintDebug` 为 0 errors，剩余警告逐项审查。
- [ ] `assembleDebug` 成功生成正式 APK。
- [ ] QA application ID 与原版并存安装，原版未被覆盖。
- [ ] 主页面和成功弹窗截图完成实际视觉核对。
- [ ] 空输入、错误完整 OP、短 OP 离线、完整 OP 成功和授权模式均完成设备验证。
- [ ] Logcat 无本应用崩溃、ANR 或虚构凭证/唤醒 URL 泄露。
- [ ] 最终 APK 元数据、签名和 SHA-256 已记录。
- [ ] `apks/短位op.apk` 和无关用户文件保持不变。
