# Unknown Sale Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add “未知” as a complete sale status and make it the default for future accounts and imports with an omitted or blank sale status.

**Architecture:** Extend the shared sale-status enum so the MongoDB model, API validation, filters, batch updates, and label rendering inherit one canonical `unknown` value. Keep import label parsing explicit, and expose a tested frontend default constant for the account drawer. Preserve all existing records and keep the banned-account `disabled` invariant higher priority.

**Tech Stack:** TypeScript, Zod, Express, Mongoose, React, TanStack Query, Vitest, XLSX, Docker Compose

## Global Constraints

- Add `unknown` with the Chinese label “未知” as a real sale-status value.
- New account inputs with omitted or `undefined` `saleStatus` default to `unknown`.
- Blank import cells default to `unknown`; explicit “未知” imports as `unknown`.
- Existing database records remain unchanged; no migration or startup normalization for this feature.
- Detected banned accounts always store `disabled`, even when the requested/default status is `unknown`.
- Banned accounts cannot be manually changed to `unknown`.
- “未知” appears in create/edit, filter, batch update, table, import, and export flows.
- “未知” uses a neutral gray table tag and is counted only in “全部账号”.

---

### Task 1: Shared Status Contract and MongoDB Validation

**Files:**
- Modify: `packages/shared/src/account.ts`
- Modify: `packages/shared/src/account.test.ts`
- Modify: `apps/api/src/tests/models.test.ts`

**Interfaces:**
- Produces: `SaleStatus` including `"unknown"`.
- Produces: `SALE_STATUS_LABELS.unknown === "未知"`.
- Produces: `AccountInputSchema` with an omitted `saleStatus` defaulting to `"unknown"`.
- Produces: `AccountListQuerySchema` accepting `saleStatus=unknown`.

- [ ] **Step 1: Write failing shared-schema tests**

Replace the old recovered-default assertion and add explicit unknown coverage:

```ts
it("defaults an omitted sale status to unknown", () => {
  const value = AccountInputSchema.parse({
    douyinId: "94946893573",
    registeredAt: "2026-07-28",
    opName: "",
    opSecret: "a|b|1782303418",
    owner: "小王",
    remark: ""
  });

  expect(value.saleStatus).toBe("unknown");
  expect(SALE_STATUS_LABELS.unknown).toBe("未知");
});

it("accepts unknown as an explicit input and list filter", () => {
  expect(AccountInputSchema.parse({
    douyinId: "94946893573",
    registeredAt: "2026-07-28",
    opName: "",
    opSecret: "a|b|1782303418",
    owner: "小王",
    saleStatus: "unknown",
    remark: ""
  }).saleStatus).toBe("unknown");

  expect(
    AccountListQuerySchema.parse({ saleStatus: "unknown" }).saleStatus
  ).toBe("unknown");
});
```

Import `SALE_STATUS_LABELS` in `account.test.ts`.

- [ ] **Step 2: Change the MongoDB enum test to expect unknown to validate**

In `models.test.ts`, replace the existing document that expects
`saleStatus: "unknown"` to fail with:

```ts
it("accepts unknown and rejects values outside the shared status enums", async () => {
  const account = new AccountModel({
    douyinId: "94946893573",
    secUid: "MS4wLjABAAAA-fixture",
    registeredAt: new Date("2026-07-28T00:00:00.000Z"),
    opName: "",
    opSecret: {
      version: 1,
      iv: "aXY=",
      ciphertext: "Y2lwaGVy",
      authTag: "dGFn"
    },
    opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
    owner: "小王",
    saleStatus: "unknown",
    accountStatus: "normal",
    accountCheckedAt: new Date(),
    remark: ""
  });

  await expect(account.validate()).resolves.toBeUndefined();
  account.saleStatus = "invalid" as never;
  await expect(account.validate()).rejects.toThrow();
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/shared exec vitest run src/account.test.ts
pnpm --filter @douyin-admin/api exec vitest run src/tests/models.test.ts
```

Expected: the shared tests reject `unknown` and still default to `recovered`;
the model rejects `unknown`.

- [ ] **Step 4: Implement the shared status**

In `packages/shared/src/account.ts`, change:

```ts
export const SALE_STATUSES = [
  "unknown",
  "unsold",
  "sold",
  "disabled",
  "recovered"
] as const;
```

Add the label first:

```ts
export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  unknown: "未知",
  unsold: "未售卖",
  sold: "已售卖",
  disabled: "已停用",
  recovered: "已找回"
};
```

Change the input default:

```ts
saleStatus: SaleStatusSchema.default("unknown")
```

- [ ] **Step 5: Run tests and type checks and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/shared exec vitest run src/account.test.ts
pnpm --filter @douyin-admin/api exec vitest run src/tests/models.test.ts
pnpm --filter @douyin-admin/shared typecheck
pnpm --filter @douyin-admin/api typecheck
```

Expected: all selected tests and both type checks pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/account.ts packages/shared/src/account.test.ts \
  apps/api/src/tests/models.test.ts
git commit -m "feat: add unknown sale status"
```

---

### Task 2: Import, Export, and Banned-Status Regression Coverage

**Files:**
- Modify: `apps/api/src/services/import-parser.ts`
- Modify: `apps/api/src/tests/import-parser.test.ts`
- Create: `apps/api/src/tests/exporter.test.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`

**Interfaces:**
- Consumes: shared `SaleStatus` including `"unknown"` and
  `SALE_STATUS_LABELS.unknown`.
- Produces: import mapping `"未知" -> "unknown"`.
- Produces: blank import `saleStatus` parsed as `"unknown"`.
- Verifies: `exportAccounts(..., "csv")` renders “未知”.
- Verifies: banned detection converts requested `"unknown"` to `"disabled"`.

- [ ] **Step 1: Write failing import tests**

Add to `import-parser.test.ts`:

```ts
it("defaults blank sale status cells to unknown", () => {
  const result = parseImport(workbookBuffer([{
    抖音号: "94946893573",
    注册时间: "2026-07-28",
    OP名称: "",
    OP卡密: "a|b|1782303418",
    归属人: "小王",
    售卖状态: "",
    备注: ""
  }]), "accounts.xlsx");

  expect(result.rows[0]?.saleStatus).toBe("unknown");
  expect(result.errors).toEqual([]);
});

it("imports an explicit unknown sale status", () => {
  const result = parseImport(workbookBuffer([{
    抖音号: "94946893573",
    注册时间: "2026-07-28",
    OP名称: "",
    OP卡密: "a|b|1782303418",
    归属人: "小王",
    售卖状态: "未知",
    备注: ""
  }]), "accounts.xlsx");

  expect(result.rows[0]?.saleStatus).toBe("unknown");
  expect(result.errors).toEqual([]);
});
```

- [ ] **Step 2: Run the import tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/import-parser.test.ts
```

Expected: the blank-cell case passes through the new shared default, while the
explicit “未知” case fails because `STATUS_MAP` has no mapping.

- [ ] **Step 3: Add the explicit import mapping**

Add to `STATUS_MAP`:

```ts
未知: "unknown",
```

- [ ] **Step 4: Add export regression coverage**

Create `exporter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { exportAccounts } from "../services/exporter";

describe("exportAccounts", () => {
  it("exports unknown sale status with its Chinese label", () => {
    const output = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-28T00:00:00.000Z"),
      opName: "",
      opSecret: {
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(() => ({
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      })),
      decrypt: vi.fn(() => "a|b|1782303418")
    }, "csv").toString("utf8");

    expect(output).toContain("未知");
  });
});
```

- [ ] **Step 5: Update service regression tests**

In `accounts.service.test.ts`:

- Change the base fixture status from `recovered` to `unknown`.
- Rename “defaults a normal account to recovered” to “defaults a normal
  account to unknown”.
- Omit `saleStatus` in that create call and assert both the model input and DTO
  contain `unknown`.
- In “forces a newly detected banned account to disabled”, submit
  `saleStatus: "unknown"` and retain the `disabled` assertion.
- In “rejects manually unlocking a banned account”, request
  `saleStatus: "unknown"` and retain the 409 code assertion.

- [ ] **Step 6: Run API tests and type checks**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run \
  src/tests/import-parser.test.ts \
  src/tests/exporter.test.ts \
  src/tests/accounts.service.test.ts \
  src/tests/sale-status-policy.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: all selected tests and API type checking pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/import-parser.ts \
  apps/api/src/tests/import-parser.test.ts \
  apps/api/src/tests/exporter.test.ts \
  apps/api/src/tests/accounts.service.test.ts
git commit -m "feat(api): support unknown sale status in data flows"
```

---

### Task 3: Frontend Default, Controls, and Neutral Tag

**Files:**
- Modify: `apps/web/src/features/account-filter-state.ts`
- Modify: `apps/web/src/features/account-filter-state.test.ts`
- Modify: `apps/web/src/features/AccountsPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: shared `SaleStatus` and labels containing `unknown`.
- Produces: `DEFAULT_ACCOUNT_SALE_STATUS: SaleStatus` with value `"unknown"`.
- Consumes: `DEFAULT_ACCOUNT_SALE_STATUS` in the blank account form.
- Produces: `.sale-unknown` neutral gray tag styling.

- [ ] **Step 1: Write a failing frontend-default test**

Update the import and add:

```ts
import {
  buildAccountExportParams,
  DEFAULT_ACCOUNT_SALE_STATUS
} from "./account-filter-state";

it("uses unknown as the new account default", () => {
  expect(DEFAULT_ACCOUNT_SALE_STATUS).toBe("unknown");
});
```

Change the export-filter fixture to:

```ts
new URLSearchParams("owner=张三&saleStatus=unknown&page=2")
```

and assert:

```ts
expect(result.get("saleStatus")).toBe("unknown");
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web exec vitest run \
  src/features/account-filter-state.test.ts
```

Expected: FAIL because `DEFAULT_ACCOUNT_SALE_STATUS` is not exported.

- [ ] **Step 3: Implement the tested frontend default**

In `account-filter-state.ts`, add:

```ts
import type { SaleStatus } from "@douyin-admin/shared";

export const DEFAULT_ACCOUNT_SALE_STATUS: SaleStatus = "unknown";
```

In `AccountsPage.tsx`, import the constant and change the blank form:

```ts
const blank = {
  douyinId: "",
  registeredAt: new Date().toISOString().slice(0, 10),
  opName: "",
  opSecret: "",
  owner: "",
  saleStatus: DEFAULT_ACCOUNT_SALE_STATUS,
  remark: ""
};
```

Because all select controls render `Object.entries(SALE_STATUS_LABELS)`, the
toolbar and drawer automatically include “未知”.

- [ ] **Step 4: Make the batch prompt use every shared label**

Replace the hard-coded prompt with:

```ts
const value = prompt(
  `请输入售卖状态：${Object.values(SALE_STATUS_LABELS).join(" / ")}`
);
```

Keep the existing label-to-key lookup so “未知” maps to `unknown`.

- [ ] **Step 5: Add the neutral unknown tag**

Add before `.sale-unsold`:

```css
.sale-unknown { color: #667085; background: #f2f4f7; }
```

- [ ] **Step 6: Run frontend tests and builds**

Run:

```bash
pnpm --filter @douyin-admin/web test
pnpm --filter @douyin-admin/web typecheck
pnpm --filter @douyin-admin/web build
```

Expected: tests, type checking, and the Vite production build pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/account-filter-state.ts \
  apps/web/src/features/account-filter-state.test.ts \
  apps/web/src/features/AccountsPage.tsx \
  apps/web/src/styles.css
git commit -m "feat(web): default sale status to unknown"
```

---

### Task 4: Documentation, Full Verification, and Docker Deployment

**Files:**
- Modify: `README.md`
- Test: all workspaces and running Docker deployment

**Interfaces:**
- Consumes: final shared, API, and Web implementation.
- Produces: verified deployment on the configured `${WEB_PORT}`.

- [ ] **Step 1: Update documentation**

Change the status list to:

```text
售卖状态：未知、未售卖、已售卖、已停用、已找回
```

State that new accounts and imports with an omitted or blank sale status default
to “未知”. Retain the banned-account “已停用” override documentation.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 3: Rebuild the existing Docker deployment**

From the project path containing Chinese characters, run:

```bash
DOCKER_BUILDKIT=0 docker compose up -d --build
docker compose ps
```

Expected: MongoDB, API, and Web are healthy; only Web publishes the configured
host port.

- [ ] **Step 4: Verify API behavior with temporary records**

Using an authenticated local session:

- create `94946893573` without `saleStatus`; verify `unknown + normal`;
- create `93180119509` with `saleStatus: "unknown"`; verify
  `disabled + banned`;
- attempt to patch the banned record to `unknown`; verify HTTP 409 and
  `BANNED_ACCOUNT_SALE_STATUS_LOCKED`;
- export the normal record and verify the output contains “未知”;
- retain the temporary records until browser verification is complete.

If either Douyin ID already exists, do not modify it. Report the collision and
use automated coverage for that path instead.

- [ ] **Step 5: Verify the browser at 1280×800**

Confirm:

- the sale-status toolbar filter includes “未知”;
- a new-account drawer defaults to “未知”;
- an existing unknown row displays a neutral gray “未知” tag;
- editing and batch status choices include “未知”;
- filtering to “未知” updates the URL with `saleStatus=unknown`;
- no browser console errors occur.

- [ ] **Step 6: Verify responsive behavior at 390×844**

Confirm:

- the filter toolbar wraps without body overflow;
- the sale-status filter remains operable;
- the account table remains horizontally scrollable.

Reset the temporary viewport override after verification.

- [ ] **Step 7: Clean up verification records**

Delete only the temporary records created in Step 4 through the authenticated
API. Confirm the original account count is restored and no temporary owner or
remark remains.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: describe unknown sale status default"
```
