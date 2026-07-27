# OP Profile Preflight Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Query the QQ OP profile API before every new account insert, use the API nickname as `OP名称`, and apply the approved sale-status and remark rules without exposing OP credentials.

**Architecture:** Add a focused QQ OP checker that normalizes every upstream response into a small discriminated union, then apply that result through a pure account-input policy before MongoDB creation. Manual creates and newly inserted import rows continue to share `AccountsService.create`; import duplicates are detected before creation so skipped or updated existing records do not trigger the new-account OP check.

**Tech Stack:** TypeScript, Node.js native `fetch`, Zod, Express, Mongoose, Vitest, pnpm workspaces, Docker Compose, MongoDB 8

## Global Constraints

- QQ requests run only in the API service and use HTTPS.
- Endpoint: `https://graph.qq.com/user/get_simple_userinfo`.
- AppID: `1105602870`.
- Timeout: 5 seconds, with no automatic retry.
- `ret = 0`: API `nickname` replaces the submitted `OP名称`; sale status is otherwise unchanged.
- `ret = -22`: submitted `OP名称` is retained and sale status becomes `disabled`.
- Other `ret`: submitted `OP名称` and sale status are retained; append `OP: <msg>` to the remark.
- Timeout, network, non-JSON, malformed response, or unusable OP credentials: retain submitted values and append `OP: 查询失败`.
- Existing remarks are preserved with the format `<原备注> | OP: <消息>`.
- Douyin `banned` status remains the highest-priority rule and always produces sale status `disabled`.
- Manual editing, Douyin recheck, and duplicate-import updates do not trigger the OP query.
- Never log or return the OP secret, `openid`, `access_token`, or full QQ request URL.
- Preserve the user-owned untracked `QQ昵称识别API说明.md`; do not stage it without explicit authorization.

---

### Task 1: Build the QQ OP profile checker

**Files:**
- Create: `apps/api/src/services/op-profile.ts`
- Create: `apps/api/src/tests/op-profile.test.ts`

**Interfaces:**
- Consumes: `baseUrl: URL`, `appId: string`, optional `fetchImpl: typeof fetch`, and optional `timeoutMs: number`.
- Produces:

```ts
export type OpProfileCheckResult =
  | { kind: "success"; nickname: string }
  | { kind: "invalid-openid" }
  | { kind: "message"; message: string }
  | { kind: "unavailable" };

export function parseOpProfileResponse(value: unknown): OpProfileCheckResult;

export function createOpProfileChecker(options: {
  baseUrl: URL;
  appId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): (opSecret: string) => Promise<OpProfileCheckResult>;
```

- [ ] **Step 1: Write failing parser tests**

Create `apps/api/src/tests/op-profile.test.ts` with focused cases:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createOpProfileChecker,
  parseOpProfileResponse
} from "../services/op-profile";

describe("parseOpProfileResponse", () => {
  it("returns the API nickname for ret 0", () => {
    expect(parseOpProfileResponse({ ret: 0, msg: "", nickname: "API昵称" }))
      .toEqual({ kind: "success", nickname: "API昵称" });
  });

  it("maps only ret -22 to invalid-openid", () => {
    expect(parseOpProfileResponse({ ret: -22, msg: "openid is invalid" }))
      .toEqual({ kind: "invalid-openid" });
  });

  it("preserves another ret message", () => {
    expect(parseOpProfileResponse({ ret: 100030, msg: "token is invalid" }))
      .toEqual({ kind: "message", message: "token is invalid" });
  });

  it("uses a stable message when another ret has no msg", () => {
    expect(parseOpProfileResponse({ ret: 1, msg: "" }))
      .toEqual({ kind: "message", message: "未知错误" });
  });

  it("treats ret 0 without a string nickname as unavailable", () => {
    expect(parseOpProfileResponse({ ret: 0, msg: "" }))
      .toEqual({ kind: "unavailable" });
  });
});
```

- [ ] **Step 2: Run the parser test to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile.test.ts
```

Expected: FAIL because `../services/op-profile` does not exist.

- [ ] **Step 3: Implement response normalization**

Create `apps/api/src/services/op-profile.ts` with Zod schemas and this exact decision order:

```ts
import { z } from "zod";

const BaseResponseSchema = z.object({
  ret: z.number().int(),
  msg: z.string().optional()
}).passthrough();

const SuccessResponseSchema = BaseResponseSchema.extend({
  ret: z.literal(0),
  nickname: z.string()
});

export type OpProfileCheckResult =
  | { kind: "success"; nickname: string }
  | { kind: "invalid-openid" }
  | { kind: "message"; message: string }
  | { kind: "unavailable" };

export function parseOpProfileResponse(value: unknown): OpProfileCheckResult {
  const base = BaseResponseSchema.safeParse(value);
  if (!base.success) return { kind: "unavailable" };
  if (base.data.ret === 0) {
    const success = SuccessResponseSchema.safeParse(value);
    return success.success
      ? { kind: "success", nickname: success.data.nickname }
      : { kind: "unavailable" };
  }
  if (base.data.ret === -22) return { kind: "invalid-openid" };
  return {
    kind: "message",
    message: base.data.msg?.trim() || "未知错误"
  };
}
```

- [ ] **Step 4: Run the parser tests to verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile.test.ts
```

Expected: all five parser tests PASS.

- [ ] **Step 5: Add failing HTTP checker tests**

Append tests that verify the first two OP segments, URL encoding, no retry, timeout/error normalization, invalid local input, and malformed JSON:

```ts
describe("createOpProfileChecker", () => {
  it("uses the first two OP segments and URL-encodes them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ret: 0, msg: "", nickname: "API昵称" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl
    });

    await expect(
      checker("open id|access+token|pay|pfkey|1782303418")
    ).resolves.toEqual({ kind: "success", nickname: "API昵称" });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("openid")).toBe("open id");
    expect(url.searchParams.get("access_token")).toBe("access+token");
    expect(url.searchParams.get("oauth_consumer_key")).toBe("1105602870");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call fetch when OP credentials cannot be extracted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl
    });

    await expect(checker("invalid")).resolves.toEqual({ kind: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["network", async () => { throw new TypeError("network"); }],
    ["non-json", async () => new Response("<html>", { status: 200 })],
    ["http error", async () => new Response("bad gateway", { status: 502 })]
  ])("normalizes %s failure without retrying", async (_name, implementation) => {
    const fetchImpl = vi.fn<typeof fetch>(implementation);
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl
    });

    await expect(checker("open|token|pay|pfkey|1782303418"))
      .resolves.toEqual({ kind: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes a timeout without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        );
      })
    );
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl,
      timeoutMs: 5
    });

    await expect(checker("open|token|pay|pfkey|1782303418"))
      .resolves.toEqual({ kind: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run the checker tests to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile.test.ts
```

Expected: FAIL because `createOpProfileChecker` is not yet exported.

- [ ] **Step 7: Implement the HTTP checker**

Add `createOpProfileChecker` to `op-profile.ts`:

```ts
export function createOpProfileChecker({
  baseUrl,
  appId,
  fetchImpl = fetch,
  timeoutMs = 5_000
}: {
  baseUrl: URL;
  appId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  return async function checkOpProfile(
    opSecret: string
  ): Promise<OpProfileCheckResult> {
    const [openid = "", accessToken = ""] = opSecret.split("|");
    if (!openid.trim() || !accessToken.trim()) return { kind: "unavailable" };

    const requestUrl = new URL(baseUrl);
    requestUrl.searchParams.set("access_token", accessToken);
    requestUrl.searchParams.set("oauth_consumer_key", appId);
    requestUrl.searchParams.set("openid", openid);

    try {
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) return { kind: "unavailable" };
      return parseOpProfileResponse(await response.json());
    } catch {
      return { kind: "unavailable" };
    }
  };
}
```

- [ ] **Step 8: Run the checker tests and typecheck**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: all OP profile tests PASS and typecheck exits 0.

- [ ] **Step 9: Commit the checker**

```bash
git add apps/api/src/services/op-profile.ts apps/api/src/tests/op-profile.test.ts
git commit -m "feat(api): add qq op profile checker"
```

---

### Task 2: Apply OP results to new account input

**Files:**
- Create: `apps/api/src/services/op-profile-policy.ts`
- Create: `apps/api/src/tests/op-profile-policy.test.ts`
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`

**Interfaces:**
- Consumes: `AccountInput` and `OpProfileCheckResult`.
- Produces:

```ts
export function applyOpProfileResult(
  input: AccountInput,
  result: OpProfileCheckResult
): AccountInput;
```

- Changes `AccountServiceDependencies` to require:

```ts
checkOpProfile(opSecret: string): Promise<OpProfileCheckResult>;
```

- [ ] **Step 1: Write failing pure-policy tests**

Create `apps/api/src/tests/op-profile-policy.test.ts`. Use a valid base input and assert every branch:

```ts
import { describe, expect, it } from "vitest";
import type { AccountInput } from "@douyin-admin/shared";
import { applyOpProfileResult } from "../services/op-profile-policy";

const input: AccountInput = {
  douyinId: "94946893573",
  registeredAt: "2026-07-28",
  opName: "导入名称",
  opSecret: "openid|token|pay|pfkey|1782303418",
  owner: "小王",
  saleStatus: "unknown",
  remark: "原备注"
};

describe("applyOpProfileResult", () => {
  it("replaces OP name on success, including an empty nickname", () => {
    expect(applyOpProfileResult(input, {
      kind: "success",
      nickname: ""
    })).toMatchObject({ opName: "", saleStatus: "unknown", remark: "原备注" });
  });

  it("forces disabled only for invalid-openid", () => {
    expect(applyOpProfileResult(input, { kind: "invalid-openid" }))
      .toMatchObject({ opName: "导入名称", saleStatus: "disabled", remark: "原备注" });
  });

  it("appends another ret message without replacing submitted fields", () => {
    expect(applyOpProfileResult(input, {
      kind: "message",
      message: "token is invalid"
    })).toMatchObject({
      opName: "导入名称",
      saleStatus: "unknown",
      remark: "原备注 | OP: token is invalid"
    });
  });

  it("uses the empty-remark format for unavailable responses", () => {
    expect(applyOpProfileResult({ ...input, remark: "" }, {
      kind: "unavailable"
    }).remark).toBe("OP: 查询失败");
  });

  it("keeps the final remark within 1000 characters", () => {
    const result = applyOpProfileResult(
      { ...input, remark: "原".repeat(1000) },
      { kind: "message", message: "错".repeat(1000) }
    );
    expect(result.remark.length).toBeLessThanOrEqual(1000);
    expect(result.remark).toContain(" | OP: ");
  });
});
```

- [ ] **Step 2: Run the policy test to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile-policy.test.ts
```

Expected: FAIL because `op-profile-policy.ts` does not exist.

- [ ] **Step 3: Implement the pure policy**

Create `apps/api/src/services/op-profile-policy.ts` with constants
`MAX_OP_NAME_LENGTH = 100` and `MAX_REMARK_LENGTH = 1000`.

Implement remark appending so the OP note is retained and the original remark is truncated first:

```ts
function appendOpRemark(remark: string, message: string): string {
  const separator = " | ";
  if (!remark) return `OP: ${message}`.slice(0, MAX_REMARK_LENGTH);
  const note = `OP: ${message}`.slice(
    0,
    MAX_REMARK_LENGTH - separator.length - 1
  );
  const originalLength = Math.max(
    1,
    MAX_REMARK_LENGTH - separator.length - note.length
  );
  return `${remark.slice(0, originalLength)}${separator}${note}`;
}
```

Use this decision table:

```ts
if (result.kind === "success") {
  return {
    ...input,
    opName: result.nickname.trim().slice(0, MAX_OP_NAME_LENGTH)
  };
}
if (result.kind === "invalid-openid") {
  return { ...input, saleStatus: "disabled" };
}
return {
  ...input,
  remark: appendOpRemark(
    input.remark,
    result.kind === "message" ? result.message : "查询失败"
  )
};
```

- [ ] **Step 4: Run the pure-policy tests to verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/op-profile-policy.test.ts
```

Expected: all five policy tests PASS.

- [ ] **Step 5: Write failing account-service integration tests**

Update the test dependency factory in `accounts.service.test.ts` to provide a
default successful `checkOpProfile`, then add tests that assert:

```ts
it("runs Douyin and OP checks before create and persists API nickname", async () => {
  const create = vi.fn(async (value: Record<string, unknown>) =>
    accountDocument(value)
  );
  const deps = dependencies({ create });
  deps.checkOpProfile.mockResolvedValue({
    kind: "success",
    nickname: "API昵称"
  });
  const service = createAccountsService(deps);

  await service.create({
    douyinId: "94946893573",
    registeredAt: "2026-07-28",
    opName: "提交名称",
    opSecret: "openid|token|pay|pfkey|1782303418",
    owner: "小王",
    saleStatus: "unknown",
    remark: ""
  }, context);

  expect(deps.checkOpProfile).toHaveBeenCalledWith(
    "openid|token|pay|pfkey|1782303418"
  );
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    opName: "API昵称",
    saleStatus: "unknown"
  }));
});
```

Also add:

- OP `invalid-openid` plus normal Douyin produces `saleStatus: "disabled"`.
- OP success plus banned Douyin still produces `saleStatus: "disabled"`.
- OP `message` persists the appended remark.
- `update()` with a changed OP secret does not call `checkOpProfile`.

- [ ] **Step 6: Run account-service tests to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/accounts.service.test.ts
```

Expected: FAIL because `checkOpProfile` is not a dependency and create does not apply the policy.

- [ ] **Step 7: Integrate the policy into `AccountsService.create`**

In `apps/api/src/services/accounts.ts`:

1. Import `OpProfileCheckResult` and `applyOpProfileResult`.
2. Add `checkOpProfile` to `AccountServiceDependencies`.
3. Destructure it in `createAccountsService`.
4. Replace the single Douyin await with:

```ts
const [detected, opResult] = await Promise.all([
  checkDouyinId(input.douyinId),
  checkOpProfile(input.opSecret)
]);
const prepared = applyOpProfileResult(input, opResult);
```

5. Build the Mongo create payload from `prepared`, not `input`.
6. Compute final status with:

```ts
saleStatus: resolveDetectedSaleStatus(
  detected.accountStatus,
  prepared.saleStatus
)
```

7. Encrypt `prepared.opSecret`, calculate expiry from `prepared.opSecret`, and
   retain the existing audit-field behavior.
8. Do not call `checkOpProfile` from `update`, `recheck`, or batch operations.

- [ ] **Step 8: Run policy, account-service, and type tests**

Run:

```bash
pnpm --filter @douyin-admin/api test -- \
  src/tests/op-profile-policy.test.ts \
  src/tests/accounts.service.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: both test files PASS and typecheck exits 0.

- [ ] **Step 9: Commit the account policy**

```bash
git add \
  apps/api/src/services/op-profile-policy.ts \
  apps/api/src/services/accounts.ts \
  apps/api/src/tests/op-profile-policy.test.ts \
  apps/api/src/tests/accounts.service.test.ts
git commit -m "feat(api): apply op profile rules before account insert"
```

---

### Task 3: Avoid OP checks for duplicate import updates and skips

**Files:**
- Modify: `apps/api/src/services/import-worker.ts`
- Create: `apps/api/src/tests/import-worker.test.ts`

**Interfaces:**
- Produces:

```ts
export type ImportRowOutcome = "created" | "updated" | "skipped";

export async function processImportRow(
  accounts: AccountsService,
  input: AccountInput,
  duplicateStrategy: "skip" | "update",
  context: AuditContext,
  findExisting?: (
    douyinId: string
  ) => Promise<{ _id: unknown } | null>
): Promise<ImportRowOutcome>;
```

- New rows call `accounts.create`, which performs the OP check from Task 2.
- Existing rows call `accounts.update` or return `skipped`, neither of which performs an OP check.

- [ ] **Step 1: Write failing import-row decision tests**

Create `apps/api/src/tests/import-worker.test.ts` with a complete valid input and
an accounts stub. Assert these calls:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AccountInput } from "@douyin-admin/shared";
import type { AccountsService, AuditContext } from "../services/accounts";
import { processImportRow } from "../services/import-worker";

const input: AccountInput = {
  douyinId: "94946893573",
  registeredAt: "2026-07-28",
  opName: "导入名称",
  opSecret: "openid|token|pay|pfkey|1782303418",
  owner: "小王",
  saleStatus: "unknown",
  remark: ""
};
const context: AuditContext = {
  ip: "127.0.0.1",
  userAgent: "test",
  requestId: "import-test"
};

function accountServiceStub() {
  return {
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({}))
  } as unknown as AccountsService;
}

it("creates a new row", async () => {
  const accounts = accountServiceStub();
  const result = await processImportRow(
    accounts,
    input,
    "skip",
    context,
    vi.fn(async () => null)
  );
  expect(result).toBe("created");
  expect(accounts.create).toHaveBeenCalledOnce();
  expect(accounts.update).not.toHaveBeenCalled();
});

it("skips an existing row without calling account services", async () => {
  const accounts = accountServiceStub();
  const findExisting = vi.fn(async () => ({ _id: "existing-id" }));
  const result = await processImportRow(
    accounts,
    input,
    "skip",
    context,
    findExisting
  );
  expect(result).toBe("skipped");
  expect(accounts.create).not.toHaveBeenCalled();
  expect(accounts.update).not.toHaveBeenCalled();
});

it("updates an existing row without calling create", async () => {
  const accounts = accountServiceStub();
  const result = await processImportRow(
    accounts,
    input,
    "update",
    context,
    vi.fn(async () => ({ _id: "existing-id" }))
  );
  expect(result).toBe("updated");
  expect(accounts.update).toHaveBeenCalledWith(
    "existing-id",
    input,
    context
  );
  expect(accounts.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the import-worker test to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/import-worker.test.ts
```

Expected: FAIL because `processImportRow` is not exported.

- [ ] **Step 3: Implement `processImportRow`**

Add the exported helper to `import-worker.ts`. Its default lookup must be:

```ts
async (douyinId) =>
  AccountModel.findOne({ douyinId }).select("_id").lean()
```

Decision order:

```ts
const existing = await findExisting(input.douyinId);
if (existing && duplicateStrategy === "skip") return "skipped";
if (existing) {
  await accounts.update(String(existing._id), input, context);
  return "updated";
}
await accounts.create(input, context);
return "created";
```

Replace the worker loop's optimistic-create duplicate handling with the helper.
Increment exactly one of `createdCount`, `updatedCount`, or `skippedCount` from
the returned outcome. Any thrown validation, Douyin, encryption, MongoDB, or
account-service error increments `failedCount`.

Keep the existing per-25-row job save and final preview deletion behavior.

- [ ] **Step 4: Run import-worker tests and the API suite**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/import-worker.test.ts
pnpm --filter @douyin-admin/api test
```

Expected: import-worker tests and the complete API suite PASS.

- [ ] **Step 5: Commit the import behavior**

```bash
git add apps/api/src/services/import-worker.ts apps/api/src/tests/import-worker.test.ts
git commit -m "refactor(api): classify import duplicates before insert"
```

---

### Task 4: Wire configuration, Docker, and documentation

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/tests/config.test.ts`
- Modify: `apps/api/src/tests/test-config.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Extends `AppConfig` with:

```ts
qqOpProfileApiUrl: URL;
qqOpAppId: string;
qqOpProfileTimeoutMs: number;
```

- [ ] **Step 1: Write failing configuration tests**

Add expectations to `config.test.ts`:

```ts
expect(config.qqOpProfileApiUrl.href).toBe(
  "https://graph.qq.com/user/get_simple_userinfo"
);
expect(config.qqOpAppId).toBe("1105602870");
expect(config.qqOpProfileTimeoutMs).toBe(5000);
```

Add rejection cases for:

```ts
it("requires an HTTPS QQ OP profile API URL", () => {
  expect(() =>
    loadConfig({
      ...validEnv,
      QQ_OP_PROFILE_API_URL:
        "http://graph.qq.com/user/get_simple_userinfo"
    })
  ).toThrow("QQ_OP_PROFILE_API_URL");
});

it("bounds the QQ OP timeout", () => {
  expect(() =>
    loadConfig({
      ...validEnv,
      QQ_OP_PROFILE_TIMEOUT_MS: "99"
    })
  ).toThrow();
});
```

Expected: HTTP is rejected and timeout must be between 100 and 30,000 ms.

- [ ] **Step 2: Run config tests to verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/config.test.ts
```

Expected: FAIL because the three config properties do not exist.

- [ ] **Step 3: Add validated OP configuration**

Extend `EnvironmentSchema`:

```ts
QQ_OP_PROFILE_API_URL: z.url()
  .default("https://graph.qq.com/user/get_simple_userinfo")
  .refine((value) => new URL(value).protocol === "https:", {
    message: "QQ_OP_PROFILE_API_URL must use HTTPS"
  }),
QQ_OP_APP_ID: z.string().trim().min(1).max(100).default("1105602870"),
QQ_OP_PROFILE_TIMEOUT_MS: z.coerce.number()
  .int()
  .min(100)
  .max(30_000)
  .default(5_000)
```

Map them to the exact `AppConfig` property names defined above. Add the same
properties to `testConfig`.

- [ ] **Step 4: Wire the checker into server startup**

In `server.ts`:

```ts
const checkOpProfile = createOpProfileChecker({
  baseUrl: config.qqOpProfileApiUrl,
  appId: config.qqOpAppId,
  timeoutMs: config.qqOpProfileTimeoutMs
});
```

Pass `checkOpProfile` to `createAccountsService`. Update all direct
`createAccountsService` calls in tests to provide a fake checker.

- [ ] **Step 5: Add Docker and example environment values**

Add to the API environment in `docker-compose.yml`:

```yaml
QQ_OP_PROFILE_API_URL: ${QQ_OP_PROFILE_API_URL:-https://graph.qq.com/user/get_simple_userinfo}
QQ_OP_APP_ID: ${QQ_OP_APP_ID:-1105602870}
QQ_OP_PROFILE_TIMEOUT_MS: ${QQ_OP_PROFILE_TIMEOUT_MS:-5000}
```

Add the same defaults to `.env.example`. Do not modify the real `.env`; Compose
defaults keep existing deployments working without exposing or changing secrets.

- [ ] **Step 6: Document the behavior**

Update `README.md` with:

- `OP名称` for new accounts is derived from the QQ API when `ret = 0`.
- `ret = -22` forces sale status to “已停用”.
- Other `ret` values append `OP: <msg>` to the remark.
- Upstream failures append `OP: 查询失败` and do not block insertion.
- Manual editing and duplicate-import updates do not query the QQ API.
- The three new environment variables and their defaults.

Do not stage `QQ昵称识别API说明.md`.

- [ ] **Step 7: Run config, typecheck, lint, and build**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/config.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 8: Commit configuration and docs**

Before staging, run `git status --short`, then stage only:

```bash
git add \
  apps/api/src/config.ts \
  apps/api/src/tests/config.test.ts \
  apps/api/src/tests/test-config.ts \
  apps/api/src/server.ts \
  docker-compose.yml \
  .env.example \
  README.md
git diff --cached --check
git commit -m "feat: configure op profile preflight checks"
```

---

### Task 5: Full regression and Docker/API verification

**Files:**
- No production files expected.
- Modify only tests or docs if verification exposes a real defect.

**Interfaces:**
- Consumes the complete OP checker, policy, import behavior, and Docker wiring.
- Produces verification evidence and a clean working tree.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected:

- Shared, web, and API test files all PASS.
- No type or lint errors.
- All packages build successfully.

If Supertest cannot bind a local port in the managed sandbox, rerun the same
`pnpm test` command with the required local-network permission and record the
sandbox `EPERM` separately from the actual test result.

- [ ] **Step 2: Rebuild the Docker deployment**

Under the Chinese-character workspace path, use the legacy builder:

```bash
DOCKER_BUILDKIT=0 docker compose \
  -p account-admin \
  --env-file /Users/edking/Documents/网赚学习/抖音谷歌本地账号管理/.env \
  up -d --build
```

Then run:

```bash
docker compose \
  -p account-admin \
  --env-file /Users/edking/Documents/网赚学习/抖音谷歌本地账号管理/.env \
  ps
```

Expected: `mongo`, `api`, and `web` are healthy; only web exposes host port
`18080`.

- [ ] **Step 3: Verify a successful live OP result without exposing credentials**

Use an authenticated local API session and a temporary directory created by
`mktemp -d`. Set every secret-bearing file to mode `0600`.

1. List accounts through `/api/accounts?page=1&pageSize=100` and select one
   existing account ID without printing its OP secret.
2. Call `/api/accounts/<id>/reveal-secret` and pipe only `.opSecret` into the
   protected temporary file; do not emit the response to terminal output.
3. If no authorized account exists, stop this live external-API step and ask the
   user for a fresh authorized OP value. Do not invent or reuse a credential
   from source control, docs, shell history, or logs.
4. Query the account list for `94946893573` and `92556139912`. Use the first
   absent ID as the temporary non-banned Douyin sample. If both are present,
   leave them untouched and report that live create verification could not be
   isolated safely.
5. Build the JSON request in the protected temporary directory, submit it, and
   save the response to another protected file without printing the request.

Assert with `jq` only these non-sensitive fields:

```text
opName is the QQ API nickname
saleStatus equals the submitted status unless Douyin is banned
remark does not contain OP: 查询失败
```

Never print the request body, OP secret, `openid`, `access_token`, or full QQ URL.
Save the created Mongo ID for exact cleanup.

- [ ] **Step 4: Verify `ret = -22`**

Using a second temporary request file with mode `0600`, keep the authorized
access token but replace only the local `openid` segment with an invalid value.
Use the other currently absent ID from `94946893573` and `92556139912` so the QQ
rule is isolated. If no second non-banned sample is available, do not alter or
delete user data; retain the automated `ret = -22` evidence and state that this
live branch could not be isolated.

Assert only:

```text
saleStatus == "disabled"
opName == submitted fallback OP name
remark == submitted remark
```

Save the created Mongo ID for exact cleanup.

- [ ] **Step 5: Verify import and cleanup**

Create a one-row temporary CSV outside the repository, upload it through
`/api/imports/preview`, execute it, and wait for its job to complete. Assert that
the imported row follows the same OP rule as manual creation.

Delete only the exact temporary account IDs created in Steps 3–5. Confirm:

- all delete responses are 204;
- no account with the unique temporary remark remains;
- no temporary request or CSV file exists after cleanup;
- pre-existing user accounts and imports are unchanged.

- [ ] **Step 6: Inspect logs and repository state**

Run:

```bash
docker compose \
  -p account-admin \
  --env-file /Users/edking/Documents/网赚学习/抖音谷歌本地账号管理/.env \
  logs --tail=200 api
git status --short
```

Confirm API logs contain no OP secret, `openid`, `access_token`, or complete QQ
request URL. The only allowed remaining status entry is the user-owned untracked
`QQ昵称识别API说明.md`.

- [ ] **Step 7: Commit verification-only fixes if needed**

If verification required a production/test/doc correction, stage only those
reviewed files, run `git diff --cached --check`, repeat the affected automated
and Docker checks, and commit:

```bash
git commit -m "fix: harden op profile preflight verification"
```

If no files changed, do not create an empty commit.
