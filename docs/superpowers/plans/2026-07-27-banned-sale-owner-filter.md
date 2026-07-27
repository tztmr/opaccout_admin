# Banned Sale Lock and Owner Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “封禁 ⇒ 已停用” an enforced server invariant, change the new-account default to “已找回”, and add database-synchronized owner filtering and suggestions.

**Architecture:** Put the sale-status invariant in a small policy service used by create, update, recheck, batch update, import, and startup normalization paths. Extend the shared list query with an exact owner filter and expose distinct owner values through the account service. The React page consumes that endpoint for a toolbar select and an editable owner suggestion list, while keeping URL and export filters aligned.

**Tech Stack:** TypeScript, Zod, Express, Mongoose, React, TanStack Query, React Router, Vitest, Docker Compose

## Global Constraints

- New account inputs default `saleStatus` to `recovered` (“已找回”).
- Every stored account with `accountStatus === "banned"` must have `saleStatus === "disabled"`.
- A banned account can never be manually changed to another sale status.
- No automatic transition from banned to another account status is designed.
- Owner options come from distinct non-empty `Account.owner` values; no new owner collection is introduced.
- Owner filtering is exact-match and must affect list results, URL state, and unselected exports.
- Existing OP-secret encryption and `sec_uid` privacy rules remain unchanged.

---

### Task 1: Shared Defaults and Owner Query Contract

**Files:**
- Modify: `packages/shared/src/account.ts`
- Test: `packages/shared/src/account.test.ts`

**Interfaces:**
- Produces: `AccountInputSchema` with `saleStatus: "recovered"` when omitted.
- Produces: `AccountListQuerySchema` with optional `owner?: string`.

- [ ] **Step 1: Write failing shared-schema tests**

Add:

```ts
it("defaults new accounts to recovered", () => {
  const value = AccountInputSchema.parse({
    douyinId: "94946893573",
    registeredAt: "2026-07-27",
    opName: "",
    opSecret: "a|b|1782303418",
    owner: "小王",
    remark: ""
  });
  expect(value.saleStatus).toBe("recovered");
});

it("accepts an exact owner list filter", () => {
  expect(AccountListQuerySchema.parse({ owner: " 张三 " }).owner).toBe("张三");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/shared exec vitest run src/account.test.ts
```

Expected: the default test receives `unsold`, and the owner query test fails because `owner` is unknown.

- [ ] **Step 3: Implement the contract**

Change:

```ts
saleStatus: SaleStatusSchema.default("recovered")
```

Add to `AccountListQuerySchema`:

```ts
owner: z.string().trim().min(1).max(100).optional()
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/shared exec vitest run src/account.test.ts
pnpm --filter @douyin-admin/shared typecheck
```

Expected: all shared tests and type checking pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/account.ts packages/shared/src/account.test.ts
git commit -m "feat: default accounts to recovered and filter by owner"
```

---

### Task 2: Enforce the Banned Sale-Status Invariant

**Files:**
- Create: `apps/api/src/services/sale-status-policy.ts`
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/tests/sale-status-policy.test.ts`
- Test: `apps/api/src/tests/accounts.service.test.ts`

**Interfaces:**
- Produces: `resolveDetectedSaleStatus(accountStatus: AccountStatus, requested: SaleStatus): SaleStatus`.
- Produces: `assertBannedSaleStatusChange(accountStatus: AccountStatus, requested?: SaleStatus): void`.
- Produces: `normalizeBannedSaleStatuses(model?: Model<AccountRecord>): Promise<number>`.

- [ ] **Step 1: Write failing policy tests**

Create:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  assertBannedSaleStatusChange,
  normalizeBannedSaleStatuses,
  resolveDetectedSaleStatus
} from "../services/sale-status-policy";

describe("banned sale-status policy", () => {
  it("forces detected banned accounts to disabled", () => {
    expect(resolveDetectedSaleStatus("banned", "recovered")).toBe("disabled");
    expect(resolveDetectedSaleStatus("normal", "recovered")).toBe("recovered");
  });

  it("rejects manually unlocking a banned account", () => {
    expect(() => assertBannedSaleStatusChange("banned", "sold"))
      .toThrow("封禁账号的售卖状态必须保持为已停用");
    expect(() => assertBannedSaleStatusChange("banned", "disabled")).not.toThrow();
  });

  it("normalizes legacy banned records", async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });
    await expect(normalizeBannedSaleStatuses({ updateMany } as never)).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      { accountStatus: "banned", saleStatus: { $ne: "disabled" } },
      { $set: { saleStatus: "disabled" } }
    );
  });
});
```

- [ ] **Step 2: Run policy tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/sale-status-policy.test.ts
```

Expected: FAIL because `sale-status-policy.ts` does not exist.

- [ ] **Step 3: Implement the policy service**

Implement:

```ts
export function resolveDetectedSaleStatus(
  accountStatus: AccountStatus,
  requested: SaleStatus
): SaleStatus {
  return accountStatus === "banned" ? "disabled" : requested;
}

export function assertBannedSaleStatusChange(
  accountStatus: AccountStatus,
  requested?: SaleStatus
): void {
  if (accountStatus === "banned" && requested && requested !== "disabled") {
    throw new AppError(
      409,
      "BANNED_ACCOUNT_SALE_STATUS_LOCKED",
      "封禁账号的售卖状态必须保持为已停用"
    );
  }
}

export async function normalizeBannedSaleStatuses(
  model: Model<AccountRecord> = AccountModel
): Promise<number> {
  const result = await model.updateMany(
    { accountStatus: "banned", saleStatus: { $ne: "disabled" } },
    { $set: { saleStatus: "disabled" } }
  );
  return result.modifiedCount;
}
```

- [ ] **Step 4: Verify the policy tests are GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/sale-status-policy.test.ts
```

Expected: three tests pass.

- [ ] **Step 5: Write failing service tests for every write path**

Extend `accounts.service.test.ts` to assert:

```ts
expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
  accountStatus: "banned",
  saleStatus: "disabled"
}));
```

Add cases that:

- create a normal account without a submitted status and receive `recovered`;
- change a Douyin ID to one detected as banned and persist `disabled`;
- recheck into banned and persist `disabled`;
- reject a single banned-account patch to `sold`;
- reject batch status update to `sold` when `countDocuments` reports a banned match;
- allow owner-only batch updates for banned accounts.

- [ ] **Step 6: Run service tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/accounts.service.test.ts
```

Expected: banned records retain the requested status and forbidden updates do not throw the lock error.

- [ ] **Step 7: Apply the policy to account operations**

In `create`, set:

```ts
saleStatus: resolveDetectedSaleStatus(detected.accountStatus, input.saleStatus)
```

In `update`:

- call `assertBannedSaleStatusChange(account.accountStatus, patch.saleStatus)` before applying a normal status patch;
- if a changed Douyin ID is detected as banned, force `patch.saleStatus`/`account.saleStatus` to `disabled` after detection.

In `recheck`, set:

```ts
account.saleStatus = resolveDetectedSaleStatus(
  detected.accountStatus,
  account.saleStatus
);
```

In `batchUpdate`, before a non-disabled `saleStatus` update:

```ts
const lockedCount = await model.countDocuments({
  _id: { $in: ids },
  accountStatus: "banned"
});
if (lockedCount > 0) {
  throw new AppError(
    409,
    "BANNED_ACCOUNT_SALE_STATUS_LOCKED",
    `${lockedCount} 个封禁账号的售卖状态必须保持为已停用`
  );
}
```

Batch recheck already delegates to `recheck`, so it inherits the rule.
The import worker already delegates new records to `accounts.create`, so imports
inherit the same invariant without a second policy implementation.

- [ ] **Step 8: Normalize legacy data during startup**

After MongoDB connects and before the import worker starts, call:

```ts
await normalizeBannedSaleStatuses();
```

- [ ] **Step 9: Run API policy and service tests**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run \
  src/tests/sale-status-policy.test.ts \
  src/tests/accounts.service.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: all selected tests and type checking pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/sale-status-policy.ts apps/api/src/services/accounts.ts \
  apps/api/src/server.ts apps/api/src/tests/sale-status-policy.test.ts \
  apps/api/src/tests/accounts.service.test.ts
git commit -m "feat(api): lock banned accounts to disabled sales"
```

---

### Task 3: Add Owner Options, Filtering, and Export Consistency

**Files:**
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/routes/accounts.ts`
- Modify: `apps/api/src/routes/exports.ts`
- Test: `apps/api/src/tests/accounts.service.test.ts`
- Test: `apps/api/src/tests/accounts.routes.test.ts`
- Create: `apps/api/src/tests/exports-filter.test.ts`

**Interfaces:**
- Produces: `AccountsService.owners(): Promise<{ items: string[] }>`.
- Produces: `GET /api/accounts/owners`.
- Consumes: `AccountListQuery.owner`.

- [ ] **Step 1: Write failing account-service owner tests**

Add tests that assert:

```ts
model.distinct.mockResolvedValue(["张三", "", "小王", "张三"]);
await expect(service.owners()).resolves.toEqual({ items: ["小王", "张三"] });
```

For list filtering, assert `model.find` receives:

```ts
expect.objectContaining({ owner: "张三" })
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/accounts.service.test.ts
```

Expected: `service.owners` is missing and list queries do not include `owner`.

- [ ] **Step 3: Implement owner service methods**

In `list` add:

```ts
if (query.owner) filter.owner = query.owner;
```

Add:

```ts
async owners(): Promise<{ items: string[] }> {
  const values = await model.distinct("owner", { owner: { $ne: "" } });
  return {
    items: [...new Set(values.map((value) => value.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
  };
}
```

- [ ] **Step 4: Write and verify a failing route test**

Add to `accounts.routes.test.ts`:

```ts
expect(accountService.owners).toHaveBeenCalledOnce();
expect(response.body).toEqual({ items: ["小王", "张三"] });
```

Run the route test and confirm `/api/accounts/owners` currently reaches `/:id` or returns 404.

- [ ] **Step 5: Add the owners route before `/:id`**

Add:

```ts
router.get("/owners", async (_req, res, next) => {
  try { res.json(await service.owners()); } catch (error) { next(error); }
});
```

- [ ] **Step 6: Extract and test export filter construction**

Export from `routes/exports.ts`:

```ts
export function buildExportFilter(query: unknown): Record<string, unknown>
```

Write `exports-filter.test.ts` asserting:

```ts
expect(buildExportFilter({ owner: "张三" })).toEqual({ owner: "张三" });
```

The helper must preserve existing keyword, sale status, account status, and registration-date behavior. Selected `ids` remain higher priority in the route.

- [ ] **Step 7: Run API owner tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run \
  src/tests/accounts.service.test.ts \
  src/tests/accounts.routes.test.ts \
  src/tests/exports-filter.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: all selected tests and type checking pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/accounts.ts apps/api/src/routes/accounts.ts \
  apps/api/src/routes/exports.ts apps/api/src/tests/accounts.service.test.ts \
  apps/api/src/tests/accounts.routes.test.ts apps/api/src/tests/exports-filter.test.ts
git commit -m "feat(api): expose and filter account owners"
```

---

### Task 4: Synchronize Owner Controls in the React Page

**Files:**
- Create: `apps/web/src/features/account-filter-state.ts`
- Test: `apps/web/src/features/account-filter-state.test.ts`
- Modify: `apps/web/src/features/AccountsPage.tsx`

**Interfaces:**
- Produces: `buildAccountExportParams(url: URLSearchParams, selected: Set<string>): URLSearchParams`.
- Consumes: `GET /api/accounts/owners` as `{ items: string[] }`.

- [ ] **Step 1: Write failing filter-state tests**

Create:

```ts
import { describe, expect, it } from "vitest";
import { buildAccountExportParams } from "./account-filter-state";

describe("account filter state", () => {
  it("includes the owner in unselected exports", () => {
    const result = buildAccountExportParams(
      new URLSearchParams("owner=张三&saleStatus=recovered&page=2"),
      new Set()
    );
    expect(result.get("owner")).toBe("张三");
    expect(result.has("page")).toBe(false);
  });

  it("prioritizes selected ids over filters", () => {
    const result = buildAccountExportParams(
      new URLSearchParams("owner=张三"),
      new Set(["a", "b"])
    );
    expect(result.get("ids")).toBe("a,b");
    expect(result.has("owner")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the web test and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web exec vitest run src/features/account-filter-state.test.ts
```

Expected: FAIL because `account-filter-state.ts` does not exist.

- [ ] **Step 3: Implement the filter helper**

Copy only these URL keys when no rows are selected:

```ts
const FILTER_KEYS = [
  "keyword",
  "saleStatus",
  "accountStatus",
  "owner",
  "registeredFrom",
  "registeredTo"
] as const;
```

Always set `format=xlsx`; set only `ids` when selection is non-empty.

- [ ] **Step 4: Run the web test and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/web exec vitest run src/features/account-filter-state.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Add synchronized owner controls**

In `AccountsPage`:

- query `{ items: string[] }` from `/api/accounts/owners`;
- read `owner` from `useSearchParams`;
- add a toolbar `<select>` after account status:

```tsx
<select
  aria-label="归属人"
  value={owner}
  onChange={(event) => updateParams({ owner: event.target.value, page: "" })}
>
  <option value="">全部归属人</option>
  {owners.map((value) => <option key={value} value={value}>{value}</option>)}
</select>
```

- include owner in the clear-filter visibility condition;
- use `buildAccountExportParams`;
- invalidate `["account-owners"]` after create, edit, and batch-owner success;
- pass `owners` into `AccountDrawer`;
- render the form input with `<datalist id="owner-options">` so existing owners are selectable while new owners remain allowed.

Change the blank form value:

```ts
saleStatus: "recovered"
```

- [ ] **Step 6: Run web verification**

Run:

```bash
pnpm --filter @douyin-admin/web test
pnpm --filter @douyin-admin/web typecheck
pnpm --filter @douyin-admin/web build
```

Expected: tests, type checking, and Vite production build pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/account-filter-state.ts \
  apps/web/src/features/account-filter-state.test.ts \
  apps/web/src/features/AccountsPage.tsx
git commit -m "feat(web): add synchronized owner controls"
```

---

### Task 5: Full Verification and Docker Deployment

**Files:**
- Modify: `README.md`
- Test: all workspace tests and running Docker deployment

**Interfaces:**
- Consumes: final API and Web source state.
- Produces: verified deployment at the configured `${WEB_PORT}`.

- [ ] **Step 1: Update behavior documentation**

Document:

- default sale status is “已找回”;
- banned accounts are server-locked to “已停用”;
- owner filtering uses current database values.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 3: Rebuild and start Docker**

Run from the current Chinese project path:

```bash
DOCKER_BUILDKIT=0 docker compose up -d --build
```

Expected: MongoDB, API, and Web become healthy; only Web publishes a host port.

- [ ] **Step 4: Verify server behavior through the deployed API**

Using an authenticated local session:

- create `93180119509` with requested `recovered`; verify stored status pair is `disabled` + `banned`;
- attempt to patch its sale status to `sold`; verify HTTP 409 and `BANNED_ACCOUNT_SALE_STATUS_LOCKED`;
- create a normal account without overriding the default; verify `recovered` + `normal`;
- verify `/api/accounts/owners` includes both test owners once each in sorted order;
- filter the list and export by one owner;
- retain the temporary records until browser verification is complete.

- [ ] **Step 5: Browser verification**

At 1280×800:

- verify “归属人” appears as a toolbar select after “账号状态”;
- verify creating a new account defaults the sale select to “已找回”;
- verify selecting an owner updates the URL and table;
- verify the form shows existing owner suggestions;
- verify a banned row displays “已停用” and “封禁” together;
- verify no browser console errors.

At 390×844:

- verify the toolbar wraps without body overflow;
- verify the account table remains horizontally scrollable;
- verify the owner select remains operable.

- [ ] **Step 6: Clean up verification data**

Delete only the temporary records created in Step 4 through the authenticated API,
then confirm the original data remains intact.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: describe banned account and owner rules"
```
