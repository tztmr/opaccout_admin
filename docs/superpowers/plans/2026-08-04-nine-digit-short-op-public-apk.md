# 9 位短 OP、公开网页与 APK 双模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给当前账号表增加唯一 9 位短 OP 和默认抖音项目，通过独立公开域名、开放 API 与 Android APK 完成网页及游戏授权上号。

**Architecture:** 账号主表继续作为唯一数据源，API 负责短码生成、现有数据迁移、OP 解密和唤醒 URL 编码。公开 React 页面和精确的短 OP 解析 API 统一通过 `op.tztright.qzz.io` 提供；APK 使用同一公开域名处理短码，同时保留完整 OP 的离线回调流程。外层 Nginx 和部署脚本为后台域名与公开 OP 域名维护独立主机配置和证书。

**Tech Stack:** pnpm 11、TypeScript 5.8、React 19、React Router 7、Express 5、Mongoose 8/MongoDB 8、Vitest 3、Nginx、Certbot、Android Gradle/Java 17。

## Global Constraints

- 账号表字段顺序保持为选择、序号、抖音号、`sec_uid`、注册时间、OP名称、OP卡密、短 OP、项目、OP到期时间、归属人、注册地区、售卖状态、账号状态、备注、操作。
- 短码必须匹配 `^[1-9][0-9]{8}$`，由服务端生成且不可由新增、编辑或导入请求指定。
- 默认项目固定为抖音，项目键 `douyin`，AppID `1105602870`。
- 后台/API 域名为 `https://tkacc.tztright.top`；公开页面域名为 `https://op.tztright.qzz.io`。
- 公开解析 API 为 `POST https://op.tztright.qzz.io/api/op/resolve`，无需管理员登录，但必须限流、禁止缓存，并与公开页面保持同源。
- 公开网页不得显示、复制、持久缓存或记录完整 OP；API 为 APK 游戏回调返回 `opData`。
- APK 默认 API 基址为 `https://op.tztright.qzz.io`，完整 OP 模式离线可用，9 位短 OP 模式必须联网。
- 保留现有完整 OP 加密、抖音检测、OP 检测、导入导出、批量操作和管理员权限行为。
- 不新增独立短 OP 表、短 OP 管理页面或项目管理页面。
- 不覆盖无关的用户修改；每次暂存前检查 `git status --short` 和 `git diff --check`。

---

## File Responsibility Map

### Create

- `packages/shared/src/short-op.ts`：短码格式、抖音项目目录、公共请求/响应类型和生产域名常量。
- `packages/shared/src/short-op.test.ts`：共享短码与项目规则测试。
- `apps/api/src/services/short-op-code.ts`：安全随机短码、创建冲突重试和现有账号幂等补齐。
- `apps/api/src/services/op-wake-url.ts`：解析完整 OP、生成二进制 plist 和项目唤醒 URL。
- `apps/api/src/services/public-op.ts`：按短码解析账号、解密 OP、校验状态/到期时间并生成公共响应。
- `apps/api/src/routes/public-op.ts`：公开限流、`no-store` 和解析接口。
- `apps/api/src/tests/short-op-code.test.ts`：生成、冲突重试与迁移测试。
- `apps/api/src/tests/op-wake-url.test.ts`：OP 字段和唤醒 URL 编码测试。
- `apps/api/src/tests/public-op.routes.test.ts`：公开 API、限流、无缓存与敏感错误测试。
- `apps/web/src/features/ShortOpPage.tsx`：公开短 OP 输入、路径预填、API 调用和唤醒恢复。
- `apps/web/src/features/public-op-routing.ts`：可信主机判断、规范链接和同源 API 路径。
- `apps/web/src/tests/short-op-page.test.tsx`：公开页面交互和路由隔离测试。
- `test/deploy-dual-domain.test.mjs`：静态验证部署脚本双域名/Nginx/Certbot 输出。
- `android-app/`：Android Gradle 工程、原生页面、授权回调、API 客户端、唤醒编码和单元测试。
- `apks/`：最终可交付调试 APK。

### Modify

- `packages/shared/src/account.ts`、`packages/shared/src/index.ts`：账号输入/DTO 增加项目和短码。
- `apps/api/src/models/account.ts`：Mongo 字段、唯一部分索引和搜索文本。
- `apps/api/src/services/accounts.ts`：新增账号分配短码、DTO/更新保留项目与短码。
- `apps/api/src/services/import-parser.ts`、`apps/api/src/services/exporter.ts`：项目导入和短码/项目导出。
- `apps/api/src/app.ts`、`apps/api/src/server.ts`：公开路由装配和启动迁移。
- `apps/api/src/tests/*.test.ts`：模型、账号、导入、导出、配置和安全回归覆盖。
- `apps/web/src/app/App.tsx`、`apps/web/src/features/AccountsPage.tsx`、`apps/web/src/styles.css`：双主机入口、公开页与账号表两列。
- `apps/web/src/tests/auth-bootstrap.test.tsx`、`apps/web/src/tests/accounts-page.test.tsx`、`apps/web/src/tests/styles.test.ts`：路由、表格和响应式样式覆盖。
- `apps/web/nginx.conf`：容器内 SPA/静态资源和代理行为保持兼容。
- `deploy-opaccout-admin.sh`、`README.md`：双域名状态、Nginx 配置、两张证书与使用说明。

---

### Task 1: 共享短码、项目与 API 契约

**Files:**
- Create: `packages/shared/src/short-op.ts`
- Create: `packages/shared/src/short-op.test.ts`
- Modify: `packages/shared/src/account.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/account.test.ts`

**Interfaces:**
- Produces: `ShortOpCodeSchema`、`OpProjectSchema`、`OP_PROJECTS`、`DEFAULT_OP_PROJECT`、`PUBLIC_OP_ORIGIN`、`PUBLIC_OP_API_URL`、`PublicOpResolveRequestSchema`、`PublicOpResolveResponse`。
- Produces: `AccountInput.opProject`、`AccountDto.shortOpCode`、`AccountDto.opProject`。
- Consumes: 现有 Zod 4 和账号输入/DTO 模式。

- [ ] **Step 1: 写共享领域失败测试**

```ts
expect(ShortOpCodeSchema.parse("123456789")).toBe("123456789");
expect(() => ShortOpCodeSchema.parse("012345678")).toThrow();
expect(DEFAULT_OP_PROJECT).toBe("douyin");
expect(OP_PROJECTS.douyin).toEqual({ key: "douyin", name: "抖音", appId: "1105602870" });
expect(AccountInputSchema.parse(baseInput).opProject).toBe("douyin");
expect(() => AccountInputSchema.parse({ ...baseInput, shortOpCode: "123456789" })).toThrow();
```

- [ ] **Step 2: 运行共享测试并确认失败**

Run: `pnpm --filter @douyin-admin/shared test`

Expected: FAIL，提示 `short-op` 导出不存在或账号类型缺少 `opProject`。

- [ ] **Step 3: 实现共享常量与类型**

```ts
export const ShortOpCodeSchema = z.string().regex(/^[1-9][0-9]{8}$/);
export const OP_PROJECTS = {
  douyin: { key: "douyin", name: "抖音", appId: "1105602870" }
} as const;
export const OpProjectSchema = z.enum(["douyin"]);
export const DEFAULT_OP_PROJECT = "douyin" as const;
export const PUBLIC_OP_ORIGIN = "https://op.tztright.qzz.io";
export const PUBLIC_OP_API_URL = `${PUBLIC_OP_ORIGIN}/api/op/resolve`;
export const PublicOpResolveRequestSchema = z.object({ code: ShortOpCodeSchema }).strict();
export type PublicOpResolveResponse = {
  status: "success";
  code: string;
  opData: string;
  project: (typeof OP_PROJECTS)[keyof typeof OP_PROJECTS];
  expiresAt: string;
  wakeUrl: string;
};
```

在 `AccountInputSchema` 中增加 `opProject: OpProjectSchema.default(DEFAULT_OP_PROJECT)`；在 `AccountDto` 中增加只读的 `shortOpCode: string` 和 `opProject: "douyin"`，不要把 `shortOpCode` 加入输入 schema。

- [ ] **Step 4: 运行共享测试和类型检查**

Run: `pnpm --filter @douyin-admin/shared test && pnpm --filter @douyin-admin/shared typecheck`

Expected: PASS。

- [ ] **Step 5: 提交共享契约**

```bash
git add packages/shared/src
git commit -m "feat: define short OP domain contracts"
```

---

### Task 2: Mongo 字段、安全生成与现有账号迁移

**Files:**
- Create: `apps/api/src/services/short-op-code.ts`
- Create: `apps/api/src/tests/short-op-code.test.ts`
- Modify: `apps/api/src/models/account.ts`
- Modify: `apps/api/src/tests/models.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_OP_PROJECT` 和 `ShortOpCodeSchema`。
- Produces: `generateShortOpCode(randomIntImpl?)`、`createAccountWithShortOpRetry(model, payload, options?)`、`backfillMissingShortOps(model, options?)`。
- Produces: `AccountRecord.shortOpCode`、`AccountRecord.opProject` 和唯一部分索引。

- [ ] **Step 1: 写生成、冲突和迁移失败测试**

```ts
expect(generateShortOpCode(() => 123456789)).toBe("123456789");
await expect(createAccountWithShortOpRetry(model, payload, { randomInt: sequence(123456789, 987654321) }))
  .resolves.toMatchObject({ shortOpCode: "987654321", opProject: "douyin" });
await backfillMissingShortOps(model, { randomInt: sequence(123456789, 987654321) });
expect(await model.countDocuments({ shortOpCode: /^[1-9][0-9]{8}$/ })).toBe(2);
```

模型测试断言：

```ts
expect(AccountModel.schema.path("shortOpCode")).toBeDefined();
expect(AccountModel.schema.path("opProject")).toBeDefined();
expect(AccountModel.schema.indexes()).toContainEqual([
  { shortOpCode: 1 },
  expect.objectContaining({ unique: true, partialFilterExpression: { shortOpCode: { $type: "string" } } })
]);
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/short-op-code.test.ts src/tests/models.test.ts`

Expected: FAIL，生成函数和模型字段尚不存在。

- [ ] **Step 3: 实现短码服务与模型索引**

```ts
export function generateShortOpCode(
  randomIntImpl: typeof randomInt = randomInt
): string {
  return String(randomIntImpl(100_000_000, 1_000_000_000));
}

export type NewAccountRecord = Omit<
  AccountRecord,
  "shortOpCode" | "searchText" | "createdAt" | "updatedAt" | "opProject"
> & { opProject?: OpProject };

export async function createAccountWithShortOpRetry(
  model: Model<AccountRecord>,
  payload: NewAccountRecord,
  { randomInt: randomIntImpl = randomInt, maxAttempts = 12 } = {}
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await model.create({
        ...payload,
        shortOpCode: generateShortOpCode(randomIntImpl),
        opProject: payload.opProject ?? DEFAULT_OP_PROJECT
      });
    } catch (error) {
      if (!isShortOpDuplicate(error)) throw error;
    }
  }
  throw new AppError(503, "SHORT_OP_EXHAUSTED", "短 OP 生成失败，请重试");
}
```

`backfillMissingShortOps()` 使用游标读取 `shortOpCode` 缺失或项目缺失的账号，以 `_id` 和字段仍缺失作为更新条件；重复键只重试当前记录。模型索引使用 `partialFilterExpression`，允许迁移前多条旧记录暂时缺少短码。

- [ ] **Step 4: 运行迁移测试和模型测试**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/short-op-code.test.ts src/tests/models.test.ts`

Expected: PASS，重复随机值被重试，幂等迁移第二次更新数为 0。

- [ ] **Step 5: 提交数据层**

```bash
git add apps/api/src/models/account.ts apps/api/src/services/short-op-code.ts apps/api/src/tests/short-op-code.test.ts apps/api/src/tests/models.test.ts
git commit -m "feat: allocate unique account short OP codes"
```

---

### Task 3: 账号 CRUD、搜索与启动补齐接线

**Files:**
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`
- Modify: `apps/api/src/tests/accounts.routes.test.ts`

**Interfaces:**
- Consumes: `createAccountWithShortOpRetry()`、`backfillMissingShortOps()` 和扩展后的 `AccountInput`。
- Produces: 所有账号 DTO 均包含 `shortOpCode` 与 `opProject`；新增账号自动分配短码；更新不会修改短码。

- [ ] **Step 1: 写账号服务失败测试**

```ts
const created = await service.create(input, auditContext);
expect(created).toMatchObject({ shortOpCode: "123456789", opProject: "douyin" });

const updated = await service.update(created._id, { remark: "changed" }, auditContext);
expect(updated.shortOpCode).toBe(created.shortOpCode);

await service.list({ keyword: "123456789" });
expect(model.find).toHaveBeenCalledWith({ searchText: /123456789/i });
```

- [ ] **Step 2: 运行账号聚焦测试并确认失败**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/accounts.service.test.ts src/tests/accounts.routes.test.ts`

Expected: FAIL，DTO 缺少新字段或创建路径未调用短码分配器。

- [ ] **Step 3: 接入创建、DTO、搜索文本和启动迁移**

```ts
function toDto(value: AccountRecord & { _id: unknown }): AccountDto {
  return {
    _id: String(value._id),
    douyinId: value.douyinId,
    secUid: value.secUid,
    registeredAt: value.registeredAt.toISOString(),
    opName: value.opName,
    hasOpSecret: true,
    shortOpCode: value.shortOpCode,
    opProject: value.opProject,
    opExpiresAt: value.opExpiresAt.toISOString(),
    owner: value.owner,
    registeredRegion: value.registeredRegion,
    saleStatus: value.saleStatus,
    accountStatus: value.accountStatus,
    accountCheckedAt: value.accountCheckedAt.toISOString(),
    remark: value.remark,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString()
  };
}
```

把 `model.create({...})` 替换为 `createAccountWithShortOpRetry(model, {...})`。模型 `searchText` 加入 `shortOpCode` 和项目显示名称。`server.ts` 在 Mongo 连接和索引同步后、启动导入 worker 和 HTTP 监听前执行：

```ts
await AccountModel.syncIndexes();
await backfillMissingShortOps(AccountModel);
```

更新只允许 `opProject` 来自 `AccountInputSchema.partial()`，不接受 `shortOpCode`。

- [ ] **Step 4: 运行账号测试和类型检查**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/accounts.service.test.ts src/tests/accounts.routes.test.ts && pnpm --filter @douyin-admin/api typecheck`

Expected: PASS。

- [ ] **Step 5: 提交账号写入路径**

```bash
git add apps/api/src/services/accounts.ts apps/api/src/server.ts apps/api/src/tests/accounts.service.test.ts apps/api/src/tests/accounts.routes.test.ts
git commit -m "feat: attach short OP codes to accounts"
```

---

### Task 4: 项目导入与短码/项目导出

**Files:**
- Modify: `apps/api/src/services/import-parser.ts`
- Modify: `apps/api/src/services/exporter.ts`
- Modify: `apps/api/src/tests/import-parser.test.ts`
- Modify: `apps/api/src/tests/exporter.test.ts`

**Interfaces:**
- Consumes: `OP_PROJECTS`、`DEFAULT_OP_PROJECT` 和账号新字段。
- Produces: 导入“项目”中文/项目键映射；导出“短 OP”“项目”列；模板增加“项目”但不增加可导入短码。

- [ ] **Step 1: 写导入导出失败测试**

```ts
expect(parseImport(workbookBuffer([{ ...row, 项目: "" }]), "accounts.xlsx").rows[0]?.opProject)
  .toBe("douyin");
expect(parseImport(workbookBuffer([{ ...row, 项目: "抖音" }]), "accounts.xlsx").rows[0]?.opProject)
  .toBe("douyin");
expect(parseImport(workbookBuffer([{ ...row, 项目: "未知项目" }]), "accounts.xlsx").errors[0]?.field)
  .toBe("opProject");
expect(csv).toContain("OP卡密,短 OP,项目,OP到期时间");
expect(csv).toContain(",123456789,抖音,");
```

- [ ] **Step 2: 运行导入导出测试并确认失败**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/exporter.test.ts`

Expected: FAIL，新列尚未生成。

- [ ] **Step 3: 实现字段映射和文本格式**

```ts
const PROJECT_MAP: Record<string, "douyin"> = { "": "douyin", 抖音: "douyin", douyin: "douyin" };
const projectLabel = String(source["项目"] ?? "").trim();
const candidate = {
  douyinId,
  registeredAt: normalizedDate(pickValue(source, "注册时间", "时间")),
  opName: String(pickValue(source, "OP名称", "op名称")).trim(),
  opSecret: String(pickValue(source, "OP卡密", "op卡密")).trim(),
  owner: String(source["归属人"] ?? "").trim(),
  registeredRegion: String(source["注册地区"] ?? "").trim() || DEFAULT_REGISTERED_REGION,
  saleStatus: saleStatusLabel ? STATUS_MAP[saleStatusLabel] ?? saleStatusLabel : undefined,
  remark: String(source["备注"] ?? "").trim(),
  opProject: PROJECT_MAP[projectLabel] ?? projectLabel
};
```

导出对象在 `OP卡密` 后插入：

```ts
"短 OP": account.shortOpCode,
项目: OP_PROJECTS[account.opProject].name,
```

XLSX 将抖音号、`sec_uid` 和短 OP 列设为文本，防止 9 位码被转科学计数法。模板表头在 `OP卡密` 后加入“项目”；解析器不读取“短 OP”列。

- [ ] **Step 4: 运行导入导出测试**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/exporter.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交导入导出**

```bash
git add apps/api/src/services/import-parser.ts apps/api/src/services/exporter.ts apps/api/src/tests/import-parser.test.ts apps/api/src/tests/exporter.test.ts
git commit -m "feat: import and export OP projects"
```

---

### Task 5: OP 唤醒 URL 编码器

**Files:**
- Create: `apps/api/src/services/op-wake-url.ts`
- Create: `apps/api/src/tests/op-wake-url.test.ts`

**Interfaces:**
- Produces: `parseOpToken(input)`、`buildOpWakeUrl(opData, appId)`。
- Consumes: 完整 OP 格式 `openid|access_token|pay_token|pfkey|auth_time`；末两段允许参考项目的默认值规则。

- [ ] **Step 1: 写编码器失败测试**

```ts
expect(parseOpToken("open|access|pay|pf|1782303418")).toEqual({
  openid: "open", accessToken: "access", payToken: "pay", pfKey: "pf", authTime: "1782303418"
});
expect(() => parseOpToken("only-one-part")).toThrow("OP 数据号格式不正确");
const url = buildOpWakeUrl("open|access|pay|pf|1782303418", "1105602870");
expect(url).toMatch(/^tencent1105602870:\/\/qzapp\/mqzone\/0\?/);
expect(Buffer.from(new URL(url).searchParams.get("pasteboard")!, "base64").subarray(0, 8).toString("ascii"))
  .toBe("bplist00");
```

- [ ] **Step 2: 运行编码测试并确认失败**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/op-wake-url.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 移植参考项目的纯 TypeScript 编码逻辑**

```ts
export function buildOpWakeUrl(opData: string, appId: string): string {
  const normalizedAppId = appId.trim();
  if (!/^\d+$/.test(normalizedAppId)) throw new Error("项目 AppID 格式不正确");
  const token = parseOpToken(opData);
  const pasteboard = writeBinaryPlist(buildPasteboard(token)).toString("base64");
  return `tencent${normalizedAppId}://qzapp/mqzone/0?objectlocation=url&pasteboard=${encodeURIComponent(pasteboard)}`;
}
```

完整移植 `UID`、对象收集、引用、ASCII/整数/UID、数组/字典和 trailer 编码函数；不要新增运行时依赖。

- [ ] **Step 4: 运行编码器测试和类型检查**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/op-wake-url.test.ts && pnpm --filter @douyin-admin/api typecheck`

Expected: PASS。

- [ ] **Step 5: 提交编码器**

```bash
git add apps/api/src/services/op-wake-url.ts apps/api/src/tests/op-wake-url.test.ts
git commit -m "feat: encode OP project wake URLs"
```

---

### Task 6: 公开解析服务、限流与无缓存 API

**Files:**
- Create: `apps/api/src/services/public-op.ts`
- Create: `apps/api/src/routes/public-op.ts`
- Create: `apps/api/src/tests/public-op.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/tests/app-security.test.ts`

**Interfaces:**
- Consumes: `PublicOpResolveRequestSchema`、`OP_PROJECTS`、`SecretCipher`、`buildOpWakeUrl()` 和 `AccountModel`。
- Produces: `createPublicOpService(options)`，返回 `PublicOpService.resolve(code): Promise<PublicOpResolveResponse | null>`。
- Produces HTTP: `POST /api/op/resolve`，由公开域名精确代理，无需登录，每 IP 每分钟最多 30 次。

- [ ] **Step 1: 写公开接口失败测试**

```ts
await request(app).post("/api/op/resolve").send({ code: "123" }).expect(400);
await request(app).post("/api/op/resolve").send({ code: "123456789" }).expect(404, {
  error: "短 OP 无效或已过期"
});
const success = await request(app)
  .post("/api/op/resolve")
  .send({ code: "123456789" })
  .expect("Cache-Control", "no-store")
  .expect(200);
expect(success.body).toMatchObject({ status: "success", opData: fixtureOp, project: { key: "douyin" } });
```

另覆盖过期、`op_invalid`、解密失败、未知项目、同 IP 第 31 次请求为 429，以及错误日志不包含 fixture OP。

- [ ] **Step 2: 运行公开接口测试并确认失败**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/public-op.routes.test.ts src/tests/app-security.test.ts`

Expected: FAIL，路由返回 404。

- [ ] **Step 3: 实现解析服务与路由**

```ts
export function createPublicOpService({
  model = AccountModel,
  cipher,
  now = () => new Date(),
  buildWakeUrl = buildOpWakeUrl
}: PublicOpServiceOptions): PublicOpService {
  return {
    async resolve(code) {
      const account = await model.findOne({ shortOpCode: code }).lean();
      if (!account || account.opExpiresAt <= now() || account.accountStatus === "op_invalid") return null;
      const project = OP_PROJECTS[account.opProject];
      if (!project) return null;
      try {
        const opData = cipher.decrypt(account.opSecret);
        return {
          status: "success", code, opData, project,
          expiresAt: account.opExpiresAt.toISOString(),
          wakeUrl: buildWakeUrl(opData, project.appId)
        };
      } catch {
        return null;
      }
    }
  };
}
```

路由在 `requireAdmin` 之前挂载。使用已安装的 `express-rate-limit`：

```ts
rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
```

格式错误返回 `{ error: "请输入正确的 9 位短码" }`；无效状态统一返回 `{ error: "短 OP 无效或已过期" }`。成功和错误均设置 `Cache-Control: no-store`。

- [ ] **Step 4: 运行公开 API 和完整 API 测试**

Run: `pnpm --filter @douyin-admin/api test && pnpm --filter @douyin-admin/api typecheck`

Expected: PASS，现有鉴权 API 不受影响。

- [ ] **Step 5: 提交公开 API**

```bash
git add apps/api/src/app.ts apps/api/src/server.ts apps/api/src/routes/public-op.ts apps/api/src/services/public-op.ts apps/api/src/tests
git commit -m "feat: expose rate-limited short OP API"
```

---

### Task 7: 公开 React 页面与双主机路由隔离

**Files:**
- Create: `apps/web/src/features/ShortOpPage.tsx`
- Create: `apps/web/src/features/public-op-routing.ts`
- Create: `apps/web/src/tests/short-op-page.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/tests/auth-bootstrap.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `PUBLIC_OP_ORIGIN`、`PUBLIC_OP_API_URL`、`PublicOpResolveResponse`。
- Produces: `isPublicOpHost(hostname)`、`publicOpApiUrl(hostname)`、`extractPublicShortCode(pathname)` 和 `ShortOpPage`。

- [ ] **Step 1: 写路由与页面失败测试**

```tsx
expect(isPublicOpHost("op.tztright.qzz.io")).toBe(true);
expect(isPublicOpHost("tkacc.tztright.top")).toBe(false);
expect(extractPublicShortCode("/123456789")).toBe("123456789");
render(<ShortOpPage pathname="/123456789" hostname="op.tztright.qzz.io" />);
expect(screen.getByLabelText("9 位短 OP")).toHaveValue("123456789");
await user.click(screen.getByRole("button", { name: "立即上号" }));
expect(fetch).toHaveBeenCalledWith("/api/op/resolve", expect.any(Object));
```

路由测试分别模拟两个 hostname，断言公开主机根路径不请求 `/api/auth/session`，后台主机根路径进入 `/login`，公开主机不能进入 `/accounts`。

- [ ] **Step 2: 运行 Web 聚焦测试并确认失败**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/short-op-page.test.tsx src/tests/auth-bootstrap.test.tsx`

Expected: FAIL，页面和主机路由函数不存在。

- [ ] **Step 3: 实现公开页面与主机分流**

```tsx
export function App() {
  const hostname = window.location.hostname.toLowerCase();
  if (isPublicOpHost(hostname)) {
    return <Routes>
      <Route path="/" element={<ShortOpPage />} />
      <Route path="/:code" element={<ShortOpPage />} />
      <Route path="/op" element={<Navigate to="/" replace />} />
      <Route path="/op/:code" element={<LegacyPublicOpRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>;
  }
  return <AdminRoutes />;
}
```

`AdminRoutes` 明确恢复后台根入口：

```tsx
function AdminRoutes() {
  return <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/setup" element={<AuthEntry mode="setup" />} />
    <Route path="/login" element={<AuthEntry mode="login" />} />
    <Route path="/*" element={<Shell />} />
  </Routes>;
}
```

公开页面和本地开发都使用同源相对地址 `/api/op/resolve`，并保留 `/op` 路由用于 QA。`PUBLIC_OP_API_URL` 用于文档、APK 构建断言和规范地址测试，不用于浏览器跨域请求。提交按钮期间禁用，失败恢复；成功后用 `window.location.assign(result.wakeUrl)`，1.5 秒未离页则恢复按钮和提示。

- [ ] **Step 4: 运行页面测试、类型检查与构建**

Run: `pnpm --filter @douyin-admin/web test && pnpm --filter @douyin-admin/web typecheck && pnpm --filter @douyin-admin/web build`

Expected: PASS。

- [ ] **Step 5: 提交公开 Web**

```bash
git add apps/web/src/app/App.tsx apps/web/src/features/ShortOpPage.tsx apps/web/src/features/public-op-routing.ts apps/web/src/tests apps/web/src/styles.css
git commit -m "feat: add public short OP web page"
```

---

### Task 8: 账号表短码/项目列、复制和编辑表单

**Files:**
- Modify: `apps/web/src/features/AccountsPage.tsx`
- Modify: `apps/web/src/tests/accounts-page.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/tests/styles.test.ts`

**Interfaces:**
- Consumes: `AccountDto.shortOpCode`、`AccountDto.opProject`、`OP_PROJECTS` 和 `PUBLIC_OP_ORIGIN`。
- Produces: 表格“短 OP”“项目”列，复制短码/分享链接操作，以及默认抖音项目选择。

- [ ] **Step 1: 写表格和表单失败测试**

```tsx
expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
  "", "序号", "抖音号", "sec_uid", "注册时间", "OP名称", "OP卡密",
  "短 OP", "项目", "OP到期时间", "归属人", "注册地区", "售卖状态", "账号状态", "备注", "操作"
]);
await user.click(screen.getByRole("button", { name: "复制短 OP 123456789" }));
expect(navigator.clipboard.writeText).toHaveBeenCalledWith("123456789");
await user.click(screen.getByRole("button", { name: "复制短 OP 链接 123456789" }));
expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://op.tztright.qzz.io/123456789");
expect(screen.getByLabelText("项目")).toHaveValue("douyin");
```

- [ ] **Step 2: 运行账号页测试并确认失败**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx src/tests/styles.test.ts`

Expected: FAIL，新表头和按钮不存在。

- [ ] **Step 3: 实现两列、复制和项目提交**

在 `OP卡密` 后插入短 OP 和项目；短码使用等宽字体，两个按钮分别复制码和规范链接。`AccountFormValue`、空白值、编辑值和提交值增加 `opProject`，首版 select 只有抖音。同步把 loading/empty 的 `colSpan` 从 14 更新为 16。

```tsx
<td className="short-op-cell">
  <span className="mono">{row.shortOpCode}</span>
  <button aria-label={`复制短 OP ${row.shortOpCode}`} onClick={() => copy(row.shortOpCode)}>复制</button>
  <button aria-label={`复制短 OP 链接 ${row.shortOpCode}`} onClick={() => copy(`${PUBLIC_OP_ORIGIN}/${row.shortOpCode}`)}>链接</button>
</td>
<td>{OP_PROJECTS[row.opProject].name}</td>
```

- [ ] **Step 4: 运行账号页测试和类型检查**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx src/tests/styles.test.ts && pnpm --filter @douyin-admin/web typecheck`

Expected: PASS，窄屏表格保持横向滚动，复选框列无省略号伪影。

- [ ] **Step 5: 提交后台 UI**

```bash
git add apps/web/src/features/AccountsPage.tsx apps/web/src/tests/accounts-page.test.tsx apps/web/src/styles.css apps/web/src/tests/styles.test.ts
git commit -m "feat: show short OP codes in account table"
```

---

### Task 9: 双域名 Nginx、独立 SSL 与部署脚本迁移

**Files:**
- Create: `test/deploy-dual-domain.test.mjs`
- Modify: `deploy-opaccout-admin.sh`
- Modify: `README.md`
- Modify: `apps/web/nginx.conf`

**Interfaces:**
- Consumes: `ADMIN_DOMAIN=tkacc.tztright.top`、`OP_PUBLIC_DOMAIN=op.tztright.qzz.io` 和 Docker Web 端口。
- Produces: `write_admin_nginx_http_conf()`、`write_public_op_nginx_http_conf()`、`setup_https()` 双域名流程和旧 `DOMAIN` 状态迁移。

- [ ] **Step 1: 写部署脚本失败测试**

```js
const script = readFileSync("deploy-opaccout-admin.sh", "utf8");
assert.match(script, /ADMIN_DOMAIN="tkacc\.tztright\.top"/);
assert.match(script, /OP_PUBLIC_DOMAIN="op\.tztright\.qzz\.io"/);
assert.match(script, /write_admin_nginx_http_conf/);
assert.match(script, /write_public_op_nginx_http_conf/);
assert.match(script, /certbot --nginx -d "\$ADMIN_DOMAIN"/);
assert.match(script, /certbot --nginx -d "\$OP_PUBLIC_DOMAIN"/);
assert.match(script, /return 302 https:\/\/\$\{OP_PUBLIC_DOMAIN\}/);
```

测试同时断言状态保存含两个域名、读取旧 `DOMAIN` 时赋给 `ADMIN_DOMAIN`、公开主机只精确代理 `location = /api/op/resolve` 且拒绝其他 `/api/` 路径。

- [ ] **Step 2: 运行部署脚本测试并确认失败**

Run: `node --test test/deploy-dual-domain.test.mjs`

Expected: FAIL，脚本仍只有 `DOMAIN`。

- [ ] **Step 3: 实现双域名配置和独立证书流程**

```bash
ADMIN_DOMAIN="tkacc.tztright.top"
OP_PUBLIC_DOMAIN="op.tztright.qzz.io"

if [[ -z "${ADMIN_DOMAIN:-}" && -n "${DOMAIN:-}" ]]; then
  ADMIN_DOMAIN="$DOMAIN"
fi
```

后台 Nginx 主机代理完整 Web/API，并为 `/op` 与 `/op/<9位码>` 返回公开域名重定向。公开主机允许 `/`、9 位路径、兼容 `/op` 路径、`/assets/`，并把精确的 `/api/op/resolve` 代理到同一 Web/API 上游；其他 `/api/` 路径直接返回 404。分别执行：

```bash
run_root certbot --nginx -d "$ADMIN_DOMAIN" --redirect -m "$EMAIL" --agree-tos --non-interactive
run_root certbot --nginx -d "$OP_PUBLIC_DOMAIN" --redirect -m "$EMAIL" --agree-tos --non-interactive
```

每次证书调用单独记录结果；一张失败时保留另一张成功状态并返回非零。状态输出和 README 明确列出后台 `https://tkacc.tztright.top/login`、开放 API `https://op.tztright.qzz.io/api/op/resolve`、公开页面、分享链接与 DNS 前置条件。

- [ ] **Step 4: 运行脚本静态测试和语法检查**

Run: `node --test test/deploy-dual-domain.test.mjs && bash -n deploy-opaccout-admin.sh`

Expected: PASS。

- [ ] **Step 5: 提交部署改造**

```bash
git add deploy-opaccout-admin.sh README.md apps/web/nginx.conf test/deploy-dual-domain.test.mjs
git commit -m "feat: deploy admin and OP domains separately"
```

---

### Task 10: Android 工程和完整 OP 离线授权基线

**Files:**
- Create: `android-app/settings.gradle`
- Create: `android-app/build.gradle`
- Create: `android-app/gradle.properties`
- Create: `android-app/gradlew` and `android-app/gradle/wrapper/*`
- Create: `android-app/app/build.gradle`
- Create: `android-app/app/src/main/AndroidManifest.xml`
- Create: `android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java`
- Create: `android-app/app/src/main/java/com/tencent/open/agent/AgentActivity.java`
- Create: `android-app/app/src/main/java/com/tencent/mobileqq/OpWakeUrlBuilder.java`
- Create: `android-app/app/src/main/res/**`
- Create: `android-app/app/src/test/java/com/tencent/mobileqq/OpWakeUrlBuilderTest.java`
- Create: `android-app/README.md`

**Interfaces:**
- Produces: Android 包 `com.tencent.mobileqq`、QQ 授权入口 `com.tencent.open.agent.AgentActivity`、`OpWakeUrlBuilder.build(opData, appId)` 和完整 OP 离线回调。
- Consumes: Java 17、compileSdk 34、minSdk 24、参考项目的图标/布局资源和 OP 二进制 plist 规则。

- [ ] **Step 1: 建立最小 Android 测试并确认工程尚不存在**

```java
@Test public void buildsDouyinWakeUrlOffline() {
  String url = OpWakeUrlBuilder.build(
      "open|access|pay|pf|1782303418", "1105602870");
  assertTrue(url.startsWith("tencent1105602870://qzapp/mqzone/0?"));
}

@Test public void rejectsIncompleteOp() {
  assertThrows(IllegalArgumentException.class, () -> OpWakeUrlBuilder.build("bad", "1105602870"));
}
```

- [ ] **Step 2: 创建工程后运行测试并确认编码器失败**

Run: `cd android-app && ./gradlew --offline testDebugUnitTest`

Expected: FAIL，`OpWakeUrlBuilder` 尚未实现或断言失败。

- [ ] **Step 3: 移植干净的原生授权壳和离线编码器**

`MainActivity` 接收 `is_auth_request` 与 `appid`；完整 OP 输入在授权模式下通过：

```java
Intent result = new Intent();
result.putExtra("op_data", opData);
setResult(RESULT_OK, result);
finish();
```

独立模式调用 `OpWakeUrlBuilder.build(opData, selectedAppId)` 并使用 `Intent.ACTION_VIEW` 打开 URI。`AgentActivity` 把游戏 AppID 传给 `MainActivity`，收到 `op_data` 后沿用参考项目的游戏回调协议。Manifest 声明 launcher、AgentActivity 和所需 intent filter；完整 OP 路径不发起网络请求。

- [ ] **Step 4: 运行 Android 单元测试和调试构建**

Run: `cd android-app && ./gradlew --offline testDebugUnitTest assembleDebug`

Expected: PASS，生成 `android-app/app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 5: 提交 Android 离线基线**

```bash
git add android-app
git commit -m "feat: add offline OP Android shell"
```

---

### Task 11: APK 9 位短 OP 联网解析与游戏回调

**Files:**
- Create: `android-app/app/src/main/java/com/tencent/mobileqq/ShortOpApiClient.java`
- Create: `android-app/app/src/main/java/com/tencent/mobileqq/ShortOpResponse.java`
- Create: `android-app/app/src/test/java/com/tencent/mobileqq/ShortOpApiClientTest.java`
- Modify: `android-app/app/build.gradle`
- Modify: `android-app/app/src/main/AndroidManifest.xml`
- Modify: `android-app/app/src/main/java/com/tencent/mobileqq/MainActivity.java`
- Modify: `android-app/app/src/main/res/layout/activity_main.xml`
- Modify: `android-app/app/src/main/res/values/strings.xml`

**Interfaces:**
- Consumes: `POST {BuildConfig.OP_API_BASE_URL}/api/op/resolve` 和响应中的 `opData`、`project.appId`、`wakeUrl`。
- Produces: `ShortOpApiClient.resolve(code)`、9 位输入自动识别、授权回调和独立唤醒。

- [ ] **Step 1: 写 API 客户端与输入分流失败测试**

```java
@Test public void recognizesNineDigitCode() {
  assertTrue(MainActivity.isShortOp("123456789"));
  assertFalse(MainActivity.isShortOp("012345678"));
  assertFalse(MainActivity.isShortOp("open|access|pay"));
}

@Test public void parsesSuccessfulResponseWithoutLoggingOp() throws Exception {
  ShortOpResponse response = ShortOpApiClient.parse(200,
      "{\"status\":\"success\",\"opData\":\"open|access|pay\",\"wakeUrl\":\"tencent1105602870://x\",\"project\":{\"key\":\"douyin\",\"name\":\"抖音\",\"appId\":\"1105602870\"}}");
  assertEquals("open|access|pay", response.opData());
}
```

- [ ] **Step 2: 运行 Android 测试并确认失败**

Run: `cd android-app && ./gradlew --offline testDebugUnitTest`

Expected: FAIL，API 客户端和输入判断不存在。

- [ ] **Step 3: 实现 HTTPS 客户端和双模式行为**

在 Gradle 中定义：

```gradle
def opApiBaseUrl = providers.gradleProperty("opApiBaseUrl")
    .getOrElse("https://op.tztright.qzz.io")
android.defaultConfig.buildConfigField "String", "OP_API_BASE_URL", "\"${opApiBaseUrl}\""
```

Manifest 增加 `android.permission.INTERNET`，并设置 `android:usesCleartextTraffic="false"`。客户端使用 `HttpsURLConnection`，连接和读取超时各 8 秒，POST JSON，不打印响应。`MainActivity` 对 9 位输入显示加载态并在后台线程解析：授权模式把 `response.opData()` 返回游戏；独立模式打开 `response.wakeUrl()`。400/404、429、超时和离线分别显示“短 OP 无效或已过期”“请求过于频繁”“连接超时”“网络不可用”。失败时不调用 `setResult(RESULT_OK)`。

- [ ] **Step 4: 运行 Android 测试与双配置构建**

Run: `cd android-app && ./gradlew --offline testDebugUnitTest assembleDebug -PopApiBaseUrl=https://op.tztright.qzz.io`

Expected: PASS，APK 内默认/覆盖地址均为 HTTPS。

- [ ] **Step 5: 提交 APK 在线模式**

```bash
git add android-app
git commit -m "feat: resolve nine-digit OP codes in Android"
```

---

### Task 12: 全量验证、浏览器 QA、APK 交付与文档收尾

**Files:**
- Modify: `README.md`
- Create: `apks/tkacc-short-op-debug.apk`
- Modify only if verification exposes a defect: files from Tasks 1-11 plus their focused tests.

**Interfaces:**
- Consumes: 全部已实现功能。
- Produces: 测试通过、实际浏览器证据、Docker 构建证据和可交付 APK。

- [ ] **Step 1: 运行工作区完整静态与测试验证**

Run: `pnpm test && pnpm typecheck && pnpm build && git diff --check`

Expected: 全部 PASS；若失败，只修复与本功能相关的根因并重跑对应聚焦测试后再重跑本命令。

- [ ] **Step 2: 运行部署脚本和 Android 验证**

Run: `node --test test/deploy-dual-domain.test.mjs && bash -n deploy-opaccout-admin.sh && cd android-app && ./gradlew --offline testDebugUnitTest assembleDebug`

Expected: 全部 PASS，调试 APK 存在。

- [ ] **Step 3: 构建 Docker 并执行本地健康检查**

Run: `docker compose build api web && docker compose up -d mongo api web && bash scripts/smoke-docker.sh`

Expected: API ready、Web 200、Mongo healthy。此步骤不等同于线上双域名或证书已验证。

- [ ] **Step 4: 用浏览器检查公开页和账号表**

在本地通过 hosts/开发主机注入分别模拟 `tkacc.tztright.top` 与 `op.tztright.qzz.io`，截取：

```text
桌面 1440x900：公开短 OP 首页、带 9 位路径、账号表新增两列
手机 390x844：公开输入页、错误提示、成功唤醒前状态
```

确认后台根入口进入登录、公开根入口不请求 session、公开域名后台路径不可用、复选框列无省略号伪影、短码复制链接正确。浏览器不得使用真实 OP；API fixture 使用虚构数据。

- [ ] **Step 5: 复制 APK、更新文档并提交收尾**

Run: `mkdir -p apks && cp android-app/app/build/outputs/apk/debug/app-debug.apk apks/tkacc-short-op-debug.apk`

README 写明两个生产域名、API 请求示例、短码等同凭证、APK 两种模式、Gradle API 地址覆盖、部署脚本双证书流程和实际验证边界。随后：

```bash
git add README.md apks/tkacc-short-op-debug.apk
git commit -m "build: add short OP Android artifact"
```

- [ ] **Step 6: 最终工作树和提交链检查**

Run: `git status --short && git log --oneline -12`

Expected: 工作树干净；提交链按共享契约、数据、API、Web、部署、Android、交付顺序存在。没有用户明确要求时不执行 `git push`，也不宣称线上 DNS、SSL 或 APK 真机回调已经验证。
