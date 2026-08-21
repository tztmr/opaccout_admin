# Douyin Google and Email Account Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing account area to “抖音谷歌账号” and add a fully isolated “抖音邮箱号” page with one required email field and no email-password field.

**Architecture:** Keep both account kinds in the existing MongoDB `Account` collection, add `accountKind: "google" | "email"`, and treat historical records without that field as Google accounts. Reuse the account service, routes, and React page with an explicit kind scope so data, stats, imports, exports, and UI state cannot mix.

**Tech Stack:** TypeScript, Zod 4, Express 5, Mongoose 8, React 19, React Router 7, TanStack Query 5, Vitest, Testing Library, SheetJS, Vite, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-google-email-account-pages-design.md`

## Global Constraints

- Historical records without `accountKind` are Google accounts; do not require a bulk migration.
- `douyinId` stays globally unique across both pages.
- Email accounts require a valid `email`; Google accounts normalize `email` to an empty string.
- Do not add, store, import, export, render, or log an email password.
- `accountKind` is immutable after creation; duplicate-import update must not move records between pages.
- Preserve password/OP-secret encryption, banned/violation rules, 500-ID batch limits, and selected-ID semantics.
- At 1920×1080 and 100% zoom, email, account password, status, and actions must be visible together without an overlay or routine horizontal dragging.
- Preserve the original checkout's deleted APK and untracked APK/`.DS_Store` files. Stage only task paths.
- Execute in a Superpowers-owned isolated worktree created from `ac00d8e` or its verified descendant.

## File Map

- `packages/shared/src/account.ts`: kind/input/patch/query/DTO contracts.
- `apps/api/src/services/account-kind.ts`: historical-aware MongoDB kind filter.
- `apps/api/src/models/account.ts`: persisted kind/email and index.
- `apps/api/src/services/accounts.ts`: scoped CRUD, stats, search, and owner options.
- Import parser, preview/job models, routes, and worker carry kind through async execution.
- Export service/routes create stable kind-specific files and templates.
- `apps/web/src/features/account-page-config.ts`: labels, routes, and visibility per kind.
- `AccountsPage.tsx` and `ImportsPage.tsx`: shared kind-aware UI without duplicate pages.

---

### Task 1: Add Shared Account-Kind Contracts and Persistence

**Files:**
- Modify: `packages/shared/src/account.ts`
- Modify: `packages/shared/src/account.test.ts`
- Create: `apps/api/src/services/account-kind.ts`
- Create: `apps/api/src/tests/account-kind.test.ts`
- Modify: `apps/api/src/models/account.ts`
- Modify: `apps/api/src/tests/models.test.ts`

**Interfaces:**
- Produces: `ACCOUNT_KINDS`, `AccountKindSchema`, `AccountKind`, `AccountPatchSchema`.
- Produces: `buildAccountKindFilter(kind)` and `resolveAccountKind(value)`.
- Produces: `accountKind` and `email` on input/DTO, plus `accountKind` on list queries.

- [ ] **Step 1: Write failing shared-schema tests**

```ts
expect(AccountInputSchema.parse(base)).toMatchObject({
  accountKind: "google",
  email: ""
});
expect(AccountListQuerySchema.parse({}).accountKind).toBe("google");
expect(AccountInputSchema.parse({
  ...base,
  accountKind: "email",
  email: " mail@example.com "
}).email).toBe("mail@example.com");
expect(() => AccountInputSchema.parse({
  ...base,
  accountKind: "email",
  email: ""
})).toThrow("邮箱不能为空");
expect(() => AccountPatchSchema.parse({ accountKind: "email" })).toThrow();
```

- [ ] **Step 2: Run the shared test and verify it fails**

Run: `pnpm --filter @douyin-admin/shared test -- src/account.test.ts`

Expected: FAIL because kind contracts do not exist.

- [ ] **Step 3: Implement input and patch schemas**

Factor current editable fields into `AccountEditableFieldsSchema`, then add:

```ts
export const ACCOUNT_KINDS = ["google", "email"] as const;
export const AccountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = z.infer<typeof AccountKindSchema>;

export const AccountInputSchema = AccountEditableFieldsSchema.extend({
  accountKind: AccountKindSchema.default("google"),
  email: z.string().trim().max(254).default("")
}).strict().superRefine((value, context) => {
  if (value.accountKind !== "email") return;
  if (!value.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "邮箱不能为空" });
  } else if (!z.string().email().safeParse(value.email).success) {
    context.addIssue({ code: "custom", path: ["email"], message: "邮箱格式不正确" });
  }
}).transform(value => ({
  ...value,
  email: value.accountKind === "email" ? value.email : ""
}));

export const AccountPatchSchema = AccountEditableFieldsSchema.partial()
  .extend({
    email: z.union([
      z.literal(""),
      z.string().trim().email("邮箱格式不正确").max(254)
    ]).optional()
  })
  .strict();
```

Add kind to `AccountListQuerySchema` with default `google`; add kind/email to `AccountDto`.

- [ ] **Step 4: Write failing API helper/model tests**

```ts
expect(buildAccountKindFilter("google")).toEqual({
  $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }]
});
expect(buildAccountKindFilter("email")).toEqual({ accountKind: "email" });
expect(resolveAccountKind(undefined)).toBe("google");
```

In model tests assert kind enum, searchable email, unchanged global `douyinId` unique index, and compound `{ accountKind: 1, registeredAt: 1, _id: 1 }` index.

- [ ] **Step 5: Run API tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/account-kind.test.ts src/tests/models.test.ts`

Expected: FAIL because helper, fields, and index are absent.

- [ ] **Step 6: Implement helper and Mongoose fields**

```ts
export function resolveAccountKind(value: AccountKind | undefined): AccountKind {
  return value ?? "google";
}

export function buildAccountKindFilter(accountKind: AccountKind) {
  return accountKind === "google"
    ? { $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }] }
    : { accountKind: "email" };
}
```

Add optional historical `accountKind`, `email` defaulting to `""`, the compound index, and email in `searchText`. Keep the existing Douyin-ID unique index unchanged and do not add a unique email index, because one mailbox may own multiple different Douyin IDs.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm --filter @douyin-admin/shared test -- src/account.test.ts`

Run: `pnpm --filter @douyin-admin/api test -- src/tests/account-kind.test.ts src/tests/models.test.ts`

Run: `pnpm --filter @douyin-admin/shared typecheck && pnpm --filter @douyin-admin/api typecheck`

Expected: all commands PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/shared/src/account.ts packages/shared/src/account.test.ts apps/api/src/services/account-kind.ts apps/api/src/tests/account-kind.test.ts apps/api/src/models/account.ts apps/api/src/tests/models.test.ts
git commit -m "feat: add Google and email account kinds"
```

---

### Task 2: Scope Account CRUD, Stats, Search, and Owners

**Files:**
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/routes/accounts.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`
- Modify: `apps/api/src/tests/accounts.routes.test.ts`

**Interfaces:**
- Consumes: shared input/patch/kind schemas and account-kind helper.
- Produces: kind-scoped `list()` and `owners()` while preserving all ID-based operations.

- [ ] **Step 1: Write failing isolation tests**

Create historical, explicit Google, and email fixtures. Assert Google results include missing-kind records, email results contain only email records, and DTOs normalize fields. Assert status stats, abnormal count, batch-keyword `distinct`, and owners all use the same kind scope. Assert create persists email kind/address and PATCH rejects `accountKind`.

```ts
expect((await service.list({ accountKind: "email" })).items).toEqual([
  expect.objectContaining({ accountKind: "email", email: "mail@example.com" })
]);
await expect(service.update(id, { accountKind: "email" }, context)).rejects.toBeDefined();
```

- [ ] **Step 2: Run service tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/accounts.service.test.ts`

Expected: FAIL because CRUD and stats are globally scoped.

- [ ] **Step 3: Implement DTO, create, list, and owners scope**

Resolve missing kind in `toDto`, persist kind/email in create, seed every list filter with `buildAccountKindFilter(query.accountKind)`, and reuse that scope for find, count, status aggregation, abnormal count, and matched-ID `distinct`.

```ts
model.aggregate([
  { $match: scope },
  { $group: { _id: "$saleStatus", count: { $sum: 1 } } }
]);
model.countDocuments({
  ...scope,
  accountStatus: { $in: ["violation", "banned", "op_invalid"] }
});
```

Change `owners(rawQuery)` to parse/default kind and scope `distinct("owner", ...)`. Pass `req.query` from the owners route.

- [ ] **Step 4: Enforce immutable kind and email update rules**

Use `AccountPatchSchema`. After loading the record, resolve its kind. Reject an empty email for email records, clear any malicious email patch for Google records, and never accept `accountKind` in PATCH.

```ts
if ("email" in patch && accountKind === "email" && !patch.email) {
  throw new AppError(400, "ACCOUNT_EMAIL_REQUIRED", "邮箱不能为空", {
    email: "邮箱不能为空"
  });
}
```

Keep omitted password/OP-secret behavior unchanged.

- [ ] **Step 5: Run service/route tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/accounts.service.test.ts src/tests/accounts.routes.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS, including existing banned, batch, password, and detection cases.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/api/src/services/accounts.ts apps/api/src/routes/accounts.ts apps/api/src/tests/accounts.service.test.ts apps/api/src/tests/accounts.routes.test.ts
git commit -m "feat: isolate account data by login kind"
```

---

### Task 3: Carry Account Kind Through Import Preview and Worker

**Files:**
- Modify: `apps/api/src/services/import-parser.ts`
- Modify: `apps/api/src/services/import-parser-worker.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/models/import-preview.ts`
- Modify: `apps/api/src/models/import-job.ts`
- Modify: `apps/api/src/services/import-worker.ts`
- Modify: `apps/api/src/tests/import-parser.test.ts`
- Modify: `apps/api/src/tests/imports.routes.test.ts`
- Modify: `apps/api/src/tests/import-worker.test.ts`
- Modify: `apps/api/src/tests/models.test.ts`

**Interfaces:**
- Produces: `parseImport(buffer, fileName, accountKind = "google")`.
- Produces: kind on preview/job records and worker inputs.
- Preserves: encrypted staged account password and OP secret.

- [ ] **Step 1: Write failing CSV/XLS/XLSX parser tests**

```ts
const csv = [
  "抖音号,邮箱,密码,注册时间,OP卡密,归属人",
  "94946893573,mail@example.com,douyin-pass,2026-07-27,a|b|1782303418,小王"
].join("\n");
expect(parseImport(Buffer.from(csv), "accounts.csv", "email").rows[0])
  .toMatchObject({
    accountKind: "email",
    email: "mail@example.com",
    accountPassword: "douyin-pass"
  });
```

Assert missing/malformed email errors point to `email`. Assert old files called without kind produce Google rows. Repeat email coverage for XLS and XLSX.

- [ ] **Step 2: Run parser tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts`

Expected: FAIL because parser ignores kind/email.

- [ ] **Step 3: Implement parser and worker-thread arguments**

Add an `AccountKind` argument and candidate fields:

```ts
const candidate = {
  accountKind,
  email: accountKind === "email"
    ? String(pickValue(source, "邮箱", "email", "Email")).trim()
    : "",
  ...existingCandidateFields
};
```

Pass kind in `workerData` and into `parseImport()` in `import-parser-worker.ts`.

- [ ] **Step 4: Write failing route/model/worker tests**

Send `.field("accountKind", "email")`; assert preview and job persist email kind, preview returns email, and staged password/OP secret remain encrypted. Assert historical preview/job without kind executes as Google. Assert duplicate update cannot cross kinds:

```ts
await expect(processImportRow(
  accounts,
  emailInput,
  "update",
  context,
  async () => ({ _id: "google-id", accountKind: "google" })
)).rejects.toMatchObject({ code: "DOUYIN_ID_DUPLICATE" });
```

- [ ] **Step 5: Run tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/imports.routes.test.ts src/tests/import-worker.test.ts src/tests/models.test.ts`

Expected: FAIL because kind is not persisted or checked.

- [ ] **Step 6: Persist and execute kind safely**

Parse multipart kind with `AccountKindSchema.parse(req.body?.accountKind ?? "google")`. Save it on preview/job. In the worker resolve `preview.accountKind ?? job.accountKind ?? "google"`, decrypt secrets, and force that kind into each `AccountInput`. Select `_id accountKind` during duplicate lookup and throw `DOUYIN_ID_DUPLICATE` when existing and incoming kinds differ.

- [ ] **Step 7: Run import tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/imports.routes.test.ts src/tests/import-worker.test.ts src/tests/models.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS and no staged plaintext password/OP secret in serialized preview data.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/api/src/services/import-parser.ts apps/api/src/services/import-parser-worker.ts apps/api/src/routes/imports.ts apps/api/src/models/import-preview.ts apps/api/src/models/import-job.ts apps/api/src/services/import-worker.ts apps/api/src/tests/import-parser.test.ts apps/api/src/tests/imports.routes.test.ts apps/api/src/tests/import-worker.test.ts apps/api/src/tests/models.test.ts
git commit -m "feat: import Google and email accounts separately"
```

---

### Task 4: Scope Templates and Exports by Account Kind

**Files:**
- Modify: `apps/api/src/services/exporter.ts`
- Modify: `apps/api/src/routes/exports.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/tests/exporter.test.ts`
- Modify: `apps/api/src/tests/exports-filter.test.ts`
- Modify: `apps/api/src/tests/exports.routes.test.ts`
- Modify: `apps/api/src/tests/audit.test.ts`

**Interfaces:**
- Produces: `exportAccounts(accounts, cipher, format, accountKind)`.
- Produces: `exportTemplate(format, accountKind)`.
- Consumes: shared kind schema and historical-aware kind filter.

- [ ] **Step 1: Write failing export/template tests**

Assert exact header order and sheet names:

```ts
expect(emailCsv.split("\n")[0]).toBe(
  "抖音号,邮箱,密码,sec_uid,注册时间,OP名称,OP卡密,短 OP,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态,备注"
);
expect(googleCsv.split("\n")[0]).toBe(
  "抖音号,密码,sec_uid,注册时间,OP名称,OP卡密,短 OP,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态,备注"
);
expect(exportTemplate("csv", "email").toString("utf8"))
  .toContain("抖音号,邮箱,密码,注册时间");
```

Assert sheet names “抖音谷歌账号”/“抖音邮箱号” and text cell types for identifiers, email, and passwords.

- [ ] **Step 2: Run exporter tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exporter.test.ts`

Expected: FAIL because exporter has one format and sheet name.

- [ ] **Step 3: Implement stable kind-specific columns**

Build row objects in explicit order. Insert `邮箱` only for email kind immediately after `抖音号`. Adjust text-column indexes for the shifted email format. Use:

```ts
XLSX.utils.book_append_sheet(
  workbook,
  sheet,
  accountKind === "email" ? "抖音邮箱号" : "抖音谷歌账号"
);
```

Default template kind to Google for old callers.

- [ ] **Step 4: Write failing route/filter/audit tests**

Assert default export scope includes missing-kind historical Google records, email export scope is exact, and selected IDs are combined with scope:

```ts
const filter = ids.length
  ? { $and: [scope, { _id: { $in: ids } }] }
  : buildExportFilter(payload);
```

Assert filenames `douyin-google-accounts.xlsx` and `douyin-email-accounts.xlsx`. Assert audit data contains field names but no email, password, or OP-secret values.

- [ ] **Step 5: Run route tests and verify they fail**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exports-filter.test.ts src/tests/exports.routes.test.ts src/tests/audit.test.ts`

Expected: FAIL because exports are globally scoped.

- [ ] **Step 6: Implement export and template route scoping**

Parse `payload.accountKind ?? "google"`; apply kind scope even when IDs are supplied; pass kind to `exportAccounts`; set matching attachment filename. Parse `accountKind` in `/api/imports/template`, call `exportTemplate(format, kind)`, and set the matching template filename.

- [ ] **Step 7: Run all export tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exporter.test.ts src/tests/exports-filter.test.ts src/tests/exports.routes.test.ts src/tests/audit.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/api/src/services/exporter.ts apps/api/src/routes/exports.ts apps/api/src/routes/imports.ts apps/api/src/tests/exporter.test.ts apps/api/src/tests/exports-filter.test.ts apps/api/src/tests/exports.routes.test.ts apps/api/src/tests/audit.test.ts
git commit -m "feat: export account pages independently"
```

---

### Task 5: Add Dual Routes and a Configurable Account Page

**Files:**
- Create: `apps/web/src/features/account-page-config.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/features/AccountsPage.tsx`
- Modify: `apps/web/src/features/account-filter-state.ts`
- Modify: `apps/web/src/features/account-filter-state.test.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/tests/accounts-page.test.tsx`
- Modify: `apps/web/src/tests/auth-bootstrap.test.tsx`
- Modify: `apps/web/src/tests/styles.test.ts`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `AccountsPage({ accountKind }: { accountKind: AccountKind })`.
- Produces: `ACCOUNT_PAGE_CONFIG[accountKind]` labels/routes/filename/`showEmail`.
- Produces: `buildAccountExportParams(url, selected, accountKind)` that always includes kind.
- Preserves: all 17 existing columns, selection, batch chunking, progress, detection, and direct account-password display.

- [ ] **Step 1: Write failing navigation tests**

```ts
expect(await screen.findByRole("link", { name: "抖音谷歌账号" }))
  .toHaveAttribute("href", "/accounts/google");
expect(screen.getByRole("link", { name: "抖音邮箱号" }))
  .toHaveAttribute("href", "/accounts/email");
expect(await screen.findByRole("heading", { name: "抖音谷歌账号管理" }))
  .toBeInTheDocument();
```

Start one test at `/accounts` and assert it reaches the Google page.

- [ ] **Step 2: Run navigation tests and verify they fail**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/auth-bootstrap.test.tsx`

Expected: FAIL because only the old route/label exists.

- [ ] **Step 3: Add page configuration and routes**

Create:

```ts
export const ACCOUNT_PAGE_CONFIG = {
  google: {
    route: "/accounts/google",
    navLabel: "抖音谷歌账号",
    title: "抖音谷歌账号管理",
    createLabel: "新增谷歌账号",
    exportFileName: "douyin-google-accounts.xlsx",
    showEmail: false
  },
  email: {
    route: "/accounts/email",
    navLabel: "抖音邮箱号",
    title: "抖音邮箱号管理",
    createLabel: "新增邮箱号",
    exportFileName: "douyin-email-accounts.xlsx",
    showEmail: true
  }
} satisfies Record<AccountKind, AccountPageConfig>;
```

Add both sidebar links/routes, redirect `/accounts` to `/accounts/google`, retain wildcard fallback, and update `index.html` title.

- [ ] **Step 4: Write failing account/filter/layout tests**

Render both routes with explicit props. Assert Google requests contain `accountKind=google`, have 17 columns, and omit email. Assert email requests contain `accountKind=email`, have 18 columns, and show full email in `title`. Assert email create sends kind/email, Google create sends kind without email, edit never sends kind, and invalid email blocks fetch. Assert exports include kind even with selected IDs; query keys/selection do not leak across kinds; CSS has an email column without a 1720px global minimum.

- [ ] **Step 5: Run focused tests and verify they fail**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx src/features/account-filter-state.test.ts src/tests/styles.test.ts`

Expected: FAIL because page requests and columns are not kind-aware.

- [ ] **Step 6: Make page data flows kind-aware**

Use kind in payloads, URL query, query keys, owner request, imports link, and export payload:

```ts
const queryKey = ["accounts", accountKind, JSON.stringify(listPayload)];
params.set("accountKind", accountKind);
const ownersKey = ["account-owners", accountKind];
const ownersUrl = `/api/accounts/owners?accountKind=${accountKind}`;
const importUrl = `/imports?accountKind=${accountKind}`;
const exportPayload = buildAccountExportParams(urlParams, selected, accountKind);
```

Use config for heading, button, and filename. Invalidate only active-kind keys.

- [ ] **Step 7: Add conditional email form/table rendering**

For email accounts render after Douyin ID:

```tsx
<label>邮箱
  <input type="email" name="email" defaultValue={state.value.email}
    required maxLength={254}/>
</label>
```

Create submits kind; edit omits kind. Insert email header/cell after Douyin ID, use `title={row.email}`, and calculate loading/empty `colSpan` as 17 or 18.

- [ ] **Step 8: Fit the email table at desktop baseline**

```css
.accounts-table-email { min-width: 1518px; }
.accounts-table .col-email { width: 108px; }
```

Keep fixed layout, ellipsis/title, compact actions, and narrow-window scroll fallback. Do not hide columns or overlay the table.

- [ ] **Step 9: Run web tests, typecheck, and build**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx src/features/account-filter-state.test.ts src/tests/auth-bootstrap.test.tsx src/tests/styles.test.ts`

Run: `pnpm --filter @douyin-admin/web typecheck`

Run: `pnpm --filter @douyin-admin/web build`

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add apps/web/src/features/account-page-config.ts apps/web/src/app/App.tsx apps/web/src/features/AccountsPage.tsx apps/web/src/features/account-filter-state.ts apps/web/src/features/account-filter-state.test.ts apps/web/src/styles.css apps/web/src/tests/accounts-page.test.tsx apps/web/src/tests/auth-bootstrap.test.tsx apps/web/src/tests/styles.test.ts apps/web/index.html
git commit -m "feat: add Google and email account pages"
```

---

### Task 6: Add Account-Kind Controls to Imports UI

**Files:**
- Modify: `apps/web/src/features/ImportsPage.tsx`
- Modify: `apps/web/src/tests/imports-page.test.tsx`

**Interfaces:**
- Consumes: preview multipart `accountKind`, kind-aware template endpoint, and job `accountKind`.
- Produces: selector defaulted from `/imports?accountKind=...` or Google.
- Preserves: drag/drop, duplicate strategy, polling, date override, and secret-safe previews.

- [ ] **Step 1: Write failing UI tests**

Render in MemoryRouter. Assert default Google, URL-selected email, template link, upload FormData kind, email paste header, no “邮箱密码”, preview cleared on kind switch, and historical jobs labeled Google.

```ts
expect(screen.getByRole("combobox", { name: "账号类型" })).toHaveValue("google");
await user.selectOptions(screen.getByRole("combobox", { name: "账号类型" }), "email");
expect(screen.getByRole("link", { name: "下载模板" }))
  .toHaveAttribute("href", "/api/imports/template?format=xlsx&accountKind=email");
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/imports-page.test.tsx`

Expected: FAIL because imports have no kind control.

- [ ] **Step 3: Implement selector, upload, template, and job labels**

Read initial kind from `useSearchParams`, default invalid values to Google, clear preview when kind changes, and update URL. Append both file and kind to FormData. Add account type column to history; missing job kind displays “抖音谷歌账号”.

- [ ] **Step 4: Make paste columns kind-aware**

```ts
const headers = accountKind === "email"
  ? ["抖音号", "邮箱", "注册时间", "OP名称", "OP卡密", "归属人", "注册地区", "售卖状态", "备注"]
  : ["抖音号", "注册时间", "OP名称", "OP卡密", "归属人", "注册地区", "售卖状态", "备注"];
```

Update placeholder/guide text. Preserve two-field date override because Douyin IDs are globally unique.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/imports-page.test.tsx`

Run: `pnpm --filter @douyin-admin/web typecheck`

Run: `pnpm --filter @douyin-admin/web build`

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/web/src/features/ImportsPage.tsx apps/web/src/tests/imports-page.test.tsx
git commit -m "feat: select account kind during imports"
```

---

### Task 7: Full Regression and Browser Verification

**Files:**
- Verify: all Task 1–6 paths
- Preserve: original checkout's user-owned APK and `.DS_Store` changes

**Interfaces:**
- Consumes: integrated data, import, export, routing, and layout flows.
- Produces: fresh automated and rendered evidence for the exact final commit.

- [ ] **Step 1: Run complete automated verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `git diff --check`

Expected: all tests/typechecks/builds pass and diff check prints nothing.

- [ ] **Step 2: Inspect scope and secret safety**

Run: `git status --short`

Run: `git diff --stat ac00d8e...HEAD`

Run: `git diff ac00d8e...HEAD -- apps/api/src/services apps/api/src/routes | rg -n "console\\.|password|opSecret|email"`

Expected: only planned paths; no email-password field; no plaintext password/OP-secret audit or logging.

- [ ] **Step 3: Start controlled browser fixture**

Use an authenticated fake API if Docker/MongoDB is unavailable. Return separate Google/email rows, a visible email/account password, and distinct banned/violation states. Never use real credentials.

- [ ] **Step 4: Verify Google compatibility at 1920×1080**

Open `/accounts`; confirm redirect to `/accounts/google`, sidebar labels, Google heading, no email column, 17 columns, `accountKind=google` request, and no console error/overlay.

- [ ] **Step 5: Verify email page at 1920×1080**

Open `/accounts/email` at 100% zoom. Confirm 18 columns; direct email/password; distinct status labels; email/password/status/actions visible together. Require table container `scrollWidth <= clientWidth`. Save screenshot outside the repository as `/tmp/douyin-email-account-page-1920x1080.jpg`.

- [ ] **Step 6: Exercise validation and active-kind actions**

Verify invalid email is blocked; valid create submits email kind; Google create omits email; recheck refreshes only active kind; import sends selected kind; export sends active kind even with selected IDs.

- [ ] **Step 7: Record live-validation boundaries**

If Docker, MongoDB, administrator session, or third-party Douyin API is unavailable, state that explicitly. Do not present controlled data as live integration proof.

- [ ] **Step 8: Confirm final branch state**

Run: `git log -8 --oneline`

Run: `git status --short --branch`

Expected: implementation commits present and no task-owned uncommitted changes. Original-checkout user files remain untouched.
