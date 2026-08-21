# Account Mobile and Column Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one optional international-format mobile number to both account kinds and let the administrator persist independent Google/Email business-column orders that drive the table, CSV, XLSX, and import templates.

**Architecture:** Shared modules define the mobile schema and stable column IDs/default orders. A focused API settings service stores and normalizes the two server-side orders; exporters and the web app consume those normalized orders rather than trusting arbitrary client columns. The account page renders its table from a column registry and a separate accessible ordering dialog, while fixed selection/index/action columns remain outside the stored order.

**Tech Stack:** TypeScript, Zod, React 19, TanStack Query, Express, Mongoose, SheetJS/XLSX, Vitest, Testing Library, Codex in-app Browser.

**Spec:** `docs/superpowers/specs/2026-08-21-account-mobile-column-order-design.md`

## Global Constraints

- Both `google` and `email` accounts have one optional `mobile` string; historical or missing values resolve to `""`.
- Normalize surrounding whitespace and collapse internal whitespace to one space; preserve `+` and never coerce a mobile number to numeric form.
- Non-empty values use `+国际区号 空格 本地号码`; examples include `+86 13037174892` and `+852 65478974`.
- Mobile is not unique and must never be written as a value to audit or console logs.
- Google and Email column orders are independent, server-persisted settings.
- Selection and sequence stay fixed first; actions stay fixed last; only business columns are persisted/reordered.
- The default mobile position is immediately after `shortOp` and before `project`.
- Do not add column hiding or user-configurable widths.
- CSV/XLSX exports and import templates use the server-normalized current-kind order; browser-supplied arbitrary column lists are never authoritative.
- Preserve global `douyinId` uniqueness, immutable account kind, historical Google fallback, 500-ID recheck chunking, banned-account OP restrictions, selection semantics, encrypted secrets, and direct administrator account-password display.
- At 1920×1080 and 100% zoom, both tables must have `scrollWidth <= clientWidth`, no overlay, and all columns present; narrow screens may scroll only inside the table container.
- Tests and browser fixtures use synthetic mobile numbers only.

---

### Task 1: Define Shared Mobile and Column Contracts

**Files:**
- Create: `packages/shared/src/account-columns.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/account.ts`
- Modify: `packages/shared/src/account.test.ts`
- Create: `packages/shared/src/account-columns.test.ts`

**Interfaces:**
- Produces: `MobileSchema`, normalized optional `mobile` on `AccountInput`, `AccountPatchSchema`, and `AccountDto`.
- Produces: `AccountColumnId`, `ACCOUNT_COLUMN_IDS`, `DEFAULT_ACCOUNT_COLUMN_ORDER`, `ACCOUNT_COLUMN_LABELS`, `ACCOUNT_IMPORT_COLUMN_IDS`, and `normalizeAccountColumnOrder(accountKind, value)`.
- Consumed by: Tasks 2–5.

- [ ] **Step 1: Write failing mobile schema tests**

Add cases to `account.test.ts`:

```ts
it.each([
  [" +86   13037174892 ", "+86 13037174892"],
  ["+852 65478974", "+852 65478974"],
  ["", ""]
])("normalizes mobile %s", (mobile, expected) => {
  const parsed = AccountInputSchema.parse({ ...validInput, mobile });
  expect(parsed.mobile).toBe(expected);
});

it.each(["86 13037174892", "+86-13037174892", "+0 12345678", "+852 "])(
  "rejects invalid mobile %s",
  (mobile) => {
    expect(AccountInputSchema.safeParse({ ...validInput, mobile }).success).toBe(false);
  }
);

it("defaults historical input mobile to empty", () => {
  expect(AccountInputSchema.parse(validInput).mobile).toBe("");
});
```

- [ ] **Step 2: Run the shared account tests and verify RED**

Run: `pnpm --filter @douyin-admin/shared test -- src/account.test.ts`

Expected: FAIL because the parsed account contract does not contain `mobile` and invalid mobile values are accepted.

- [ ] **Step 3: Implement the shared mobile schema**

Add to `account.ts`:

```ts
export const MobileSchema = z.preprocess(
  (value) => typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : value,
  z.string().max(32).refine(
    (value) => value === "" || (
      /^\+[1-9]\d{0,2} \d{5,14}$/.test(value) &&
      value.replace(/\D/g, "").length <= 15
    ),
    "手机号格式不正确，请使用 +国际区号 本地号码"
  )
).default("");
```

Add `mobile: MobileSchema` to `AccountEditableFieldsSchema` so create and patch share it, add `mobile?: string` to the public `AccountInput` helper type if TypeScript still requires it, and add `mobile: string` to `AccountDto`.

- [ ] **Step 4: Write failing column-order contract tests**

Create `account-columns.test.ts` with exact assertions:

```ts
expect(DEFAULT_ACCOUNT_COLUMN_ORDER.google).toEqual([
  "douyin", "password", "secuid", "date", "opname", "opsecret",
  "shortop", "mobile", "project", "expiry", "owner", "region",
  "sale", "status", "remark"
]);
expect(DEFAULT_ACCOUNT_COLUMN_ORDER.email).toEqual([
  "douyin", "email", "password", "secuid", "date", "opname",
  "opsecret", "shortop", "mobile", "project", "expiry", "owner",
  "region", "sale", "status", "remark"
]);
expect(normalizeAccountColumnOrder("google", ["remark", "douyin", "remark", "email", "unknown"]))
  .toEqual([
    "remark", "douyin", "password", "secuid", "date", "opname",
    "opsecret", "shortop", "mobile", "project", "expiry", "owner",
    "region", "sale", "status"
  ]);
```

Also assert Email keeps `email`, Google removes it, non-arrays fall back to defaults, and every import column is an allowed business column.

- [ ] **Step 5: Run column tests and verify RED**

Run: `pnpm --filter @douyin-admin/shared test -- src/account-columns.test.ts`

Expected: FAIL because `account-columns.ts` does not exist.

- [ ] **Step 6: Implement the stable column registry**

Create `account-columns.ts` with these exact stable IDs:

```ts
export const ACCOUNT_COLUMN_IDS = [
  "douyin", "email", "password", "secuid", "date", "opname",
  "opsecret", "shortop", "mobile", "project", "expiry", "owner",
  "region", "sale", "status", "remark"
] as const;
export type AccountColumnId = (typeof ACCOUNT_COLUMN_IDS)[number];

export const DEFAULT_ACCOUNT_COLUMN_ORDER: Record<AccountKind, AccountColumnId[]> = {
  google: ["douyin", "password", "secuid", "date", "opname", "opsecret", "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status", "remark"],
  email: ["douyin", "email", "password", "secuid", "date", "opname", "opsecret", "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status", "remark"]
};

export const ACCOUNT_IMPORT_COLUMN_IDS: AccountColumnId[] = [
  "douyin", "email", "password", "date", "opname", "opsecret",
  "mobile", "project", "owner", "region", "sale", "remark"
];
```

Define Chinese labels for every ID. `normalizeAccountColumnOrder` preserves the submitted valid unique prefix and inserts omitted IDs in default-relative positions; a non-array returns a cloned default. Export the module from `index.ts`.

- [ ] **Step 7: Run shared tests and typecheck**

Run: `pnpm --filter @douyin-admin/shared test`

Run: `pnpm --filter @douyin-admin/shared typecheck`

Expected: all shared tests and typecheck PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/shared/src/account.ts packages/shared/src/account.test.ts packages/shared/src/account-columns.ts packages/shared/src/account-columns.test.ts packages/shared/src/index.ts
git commit -m "feat: define mobile and account column contracts"
```

---

### Task 2: Persist and Import Mobile Numbers

**Files:**
- Modify: `apps/api/src/models/account.ts`
- Modify: `apps/api/src/services/accounts.ts`
- Modify: `apps/api/src/services/import-parser.ts`
- Modify: `apps/api/src/tests/models.test.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`
- Modify: `apps/api/src/tests/import-parser.test.ts`
- Modify: `apps/api/src/tests/import-worker.test.ts`

**Interfaces:**
- Consumes: Task 1 `MobileSchema` through `AccountInputSchema`/`AccountPatchSchema`.
- Produces: `AccountRecord.mobile?: string`, DTO `mobile: string`, searchable persisted mobile values, and imported `mobile` rows.
- Consumed by: Tasks 4–5.

- [ ] **Step 1: Write failing model and service tests**

Add assertions that the Mongoose schema has an optional trimmed `mobile` field with default `""`, create persists the normalized value, patch updates it, DTO returns it, and a legacy record without it returns `""`:

```ts
expect(result.mobile).toBe("+86 13037174892");
expect(createdPayload.mobile).toBe("+86 13037174892");
expect(legacyDto.mobile).toBe("");
```

Assert `searchText` includes the mobile text after validation. Assert audit `changedFields` may contain the field name `mobile` but no event contains the mobile value.

- [ ] **Step 2: Run focused API tests and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/models.test.ts src/tests/accounts.service.test.ts`

Expected: FAIL because the model and DTO omit `mobile`.

- [ ] **Step 3: Implement model and service support**

Add to `AccountRecord` and `AccountSchema`:

```ts
mobile?: string;
// schema
mobile: { type: String, required: false, trim: true, maxlength: 32, default: "" }
```

Add `mobile: value.mobile ?? ""` to `toDto`, and include `this.mobile` in the model `searchText` builder. Existing create/update spreads then persist the shared parsed field without a special branch.

- [ ] **Step 4: Write failing import tests**

Add CSV/XLSX cases:

```ts
const result = parseImport(workbookBuffer([{
  抖音号: "94946893573",
  手机号: " +852   65478974 ",
  注册时间: "2026-07-27",
  OP卡密: "a|b|1782303418",
  归属人: "小王"
}]), "accounts.xlsx", "google");
expect(result.rows[0]?.mobile).toBe("+852 65478974");
```

Add an invalid `手机号: "852-65478974"` row asserting `{ field: "mobile", code: "VALIDATION_FAILED" }`. Add an import-worker assertion that create/update receives mobile and a legacy row without it receives `""`.

- [ ] **Step 5: Run import tests and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/import-worker.test.ts`

Expected: FAIL because the parser never reads `手机号`.

- [ ] **Step 6: Implement import parsing**

Add to the parser candidate before schema parsing:

```ts
mobile: String(pickValue(source, "手机号", "mobile", "Mobile")).trim(),
```

Do not add positional parsing; keep header-based matching. The worker continues forwarding the parsed row through the existing create/update boundaries.

- [ ] **Step 7: Run API tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/models.test.ts src/tests/accounts.service.test.ts src/tests/import-parser.test.ts src/tests/import-worker.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/api/src/models/account.ts apps/api/src/services/accounts.ts apps/api/src/services/import-parser.ts apps/api/src/tests/models.test.ts apps/api/src/tests/accounts.service.test.ts apps/api/src/tests/import-parser.test.ts apps/api/src/tests/import-worker.test.ts
git commit -m "feat: persist and import account mobile numbers"
```

---

### Task 3: Store Independent Server Column Orders

**Files:**
- Create: `apps/api/src/services/account-column-settings.ts`
- Modify: `apps/api/src/models/setting.ts`
- Modify: `apps/api/src/routes/settings.ts`
- Modify: `apps/api/src/tests/models.test.ts`
- Modify: `apps/api/src/tests/settings.routes.test.ts`
- Create: `apps/api/src/tests/account-column-settings.test.ts`

**Interfaces:**
- Consumes: Task 1 `AccountColumnId`, defaults, and normalizer.
- Produces: `getAccountColumnOrder(accountKind)`, `getAccountColumnOrders()`, and `saveAccountColumnOrder(accountKind, rawOrder)`.
- Produces authenticated endpoints: `GET /api/settings/account-columns` and `PATCH /api/settings/account-columns/:accountKind` with body `{ order: AccountColumnId[] }`.
- Consumed by: Tasks 4–5.

- [ ] **Step 1: Write failing service tests**

Create tests with an injected repository/model stub asserting:

```ts
expect(await service.getAccountColumnOrder("google")).toEqual(
  DEFAULT_ACCOUNT_COLUMN_ORDER.google
);
expect(await service.saveAccountColumnOrder("email", ["remark", "email", "douyin"]))
  .toEqual(normalizeAccountColumnOrder("email", ["remark", "email", "douyin"]));
```

Assert Google and Email writes update only their own settings field; duplicate, unknown, wrong-kind, empty, and omitted IDs are normalized before storage.

- [ ] **Step 2: Run the service test and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/account-column-settings.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Add settings persistence and focused service**

Extend `SettingRecord`/schema:

```ts
googleColumnOrder: AccountColumnId[];
emailColumnOrder: AccountColumnId[];
```

Use string arrays with `enum: ACCOUNT_COLUMN_IDS` and defaults from the shared module. Create the service with a small injectable model interface and these exact exports:

```ts
export async function getAccountColumnOrders(): Promise<Record<AccountKind, AccountColumnId[]>>;
export async function getAccountColumnOrder(accountKind: AccountKind): Promise<AccountColumnId[]>;
export async function saveAccountColumnOrder(accountKind: AccountKind, rawOrder: unknown): Promise<AccountColumnId[]>;
```

Every read normalizes old/missing arrays. Every save uses `$set` only for `${accountKind}ColumnOrder`; `$setOnInsert` supplies `key`, `defaultPageSize`, and `sessionHours`.

- [ ] **Step 4: Write failing authenticated route tests**

Add tests that GET returns both default arrays, PATCH Email returns/saves a normalized Email array without changing Google, PATCH Google rejects an invalid kind URL, and the existing `/api/settings` PATCH still accepts only `defaultPageSize`/`sessionHours`.

```ts
const response = await agent.patch("/api/settings/account-columns/email").send({
  order: ["remark", "email", "douyin"]
});
expect(response.body.order.slice(0, 3)).toEqual(["remark", "email", "douyin"]);
```

- [ ] **Step 5: Run settings tests and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/settings.routes.test.ts`

Expected: FAIL with 404 for the new routes.

- [ ] **Step 6: Implement the route handlers**

Add child routes before `/:accountKind` could shadow other paths:

```ts
router.get("/account-columns", async (_req, res, next) => {
  try { res.json(await getAccountColumnOrders()); }
  catch (error) { next(error); }
});

router.patch("/account-columns/:accountKind", async (req, res, next) => {
  try {
    const accountKind = AccountKindSchema.parse(req.params.accountKind);
    const body = z.object({ order: z.array(z.string()) }).strict().parse(req.body);
    res.json({ accountKind, order: await saveAccountColumnOrder(accountKind, body.order) });
  } catch (error) { next(error); }
});
```

- [ ] **Step 7: Run settings/model tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/account-column-settings.test.ts src/tests/settings.routes.test.ts src/tests/models.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/api/src/models/setting.ts apps/api/src/services/account-column-settings.ts apps/api/src/routes/settings.ts apps/api/src/tests/models.test.ts apps/api/src/tests/account-column-settings.test.ts apps/api/src/tests/settings.routes.test.ts
git commit -m "feat: persist account column orders"
```

---

### Task 4: Drive Exports and Templates from Saved Order

**Files:**
- Create: `apps/api/src/services/account-export-columns.ts`
- Modify: `apps/api/src/services/exporter.ts`
- Modify: `apps/api/src/routes/exports.ts`
- Modify: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/services/audit.ts`
- Modify: `apps/api/src/tests/exporter.test.ts`
- Modify: `apps/api/src/tests/exports.routes.test.ts`
- Modify: `apps/api/src/tests/imports.routes.test.ts`
- Modify: `apps/api/src/tests/audit.test.ts`

**Interfaces:**
- Consumes: Task 1 column IDs/importable IDs and Task 3 `getAccountColumnOrder`.
- Produces: `buildAccountExportColumns(accountKind, order, cipher)` descriptors with `id`, `header`, `text`, and `value(account)`.
- Changes: `exportAccounts(accounts, cipher, format, accountKind, columnOrder)` and `exportTemplate(format, accountKind, columnOrder)`.
- Consumed by: export/template routes and Task 6 verification.

- [ ] **Step 1: Write failing order-driven exporter tests**

Add Google and Email cases with custom order:

```ts
const order: AccountColumnId[] = [
  "remark", "mobile", "shortop", "douyin", "password", "secuid",
  "date", "opname", "opsecret", "project", "expiry", "owner",
  "region", "sale", "status"
];
const csv = exportAccounts([fixture], cipher, "csv", "google", order).toString("utf8");
expect(csv.split("\n")[0]).toBe(
  "备注,手机号,短 OP,抖音号,密码,sec_uid,注册时间,OP名称,OP卡密,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态"
);
```

Assert the value row follows the same positions. In XLSX assert the mobile cell has `{ t: "s", z: "@", v: "+86 13037174892" }`. Assert Email includes `邮箱` only where its saved order places it.

- [ ] **Step 2: Run exporter tests and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exporter.test.ts`

Expected: FAIL because exporters use hard-coded arrays and ignore the fifth argument.

- [ ] **Step 3: Implement descriptor-driven export**

Create `account-export-columns.ts` as the only API mapping from stable IDs to data:

```ts
export type AccountExportColumn = {
  id: AccountColumnId;
  header: string;
  text: boolean;
  value(account: AccountRecord & { _id: unknown }): string;
};
```

Descriptors decrypt `password`/`opsecret`, format dates/status/project, and return `account.mobile ?? ""` for mobile. `buildAccountExportColumns` first normalizes the order for the kind, then maps descriptors. `exportAccounts` constructs headers/rows from descriptors and marks every `text` descriptor by its dynamic index.

`exportTemplate` filters the normalized order through `ACCOUNT_IMPORT_COLUMN_IDS`; it maps import headers and includes any required import IDs missing from a corrupted historical order through the shared normalizer.

- [ ] **Step 4: Write failing route and audit tests**

Mock the column-settings read and assert:

- selected-ID and full exports call the exporter with the same saved order;
- browser body `columnOrder: ["remark"]` is ignored;
- Google/Email template routes use their own saved orders;
- audit `changedFields` follows exported stable field names and contains `mobile` as a name only;
- no synthetic mobile/email/password/OP value occurs anywhere in the recorded event.

- [ ] **Step 5: Run route/audit tests and verify RED**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exports.routes.test.ts src/tests/imports.routes.test.ts src/tests/audit.test.ts`

Expected: FAIL because the routes do not read saved settings.

- [ ] **Step 6: Wire server-authoritative orders**

In each export/template handler:

```ts
const columnOrder = await getAccountColumnOrder(accountKind);
```

Pass it to `exportAccounts`/`exportTemplate`. Do not parse or forward `payload.columnOrder`. Build audit field names from the descriptors, and add `mobile` to the audit field-name allow-list without ever adding values.

- [ ] **Step 7: Run API tests and typecheck**

Run: `pnpm --filter @douyin-admin/api test -- src/tests/exporter.test.ts src/tests/exports.routes.test.ts src/tests/imports.routes.test.ts src/tests/audit.test.ts`

Run: `pnpm --filter @douyin-admin/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/api/src/services/account-export-columns.ts apps/api/src/services/exporter.ts apps/api/src/services/audit.ts apps/api/src/routes/exports.ts apps/api/src/routes/imports.ts apps/api/src/tests/exporter.test.ts apps/api/src/tests/exports.routes.test.ts apps/api/src/tests/imports.routes.test.ts apps/api/src/tests/audit.test.ts
git commit -m "feat: export accounts in saved column order"
```

---

### Task 5: Add Mobile UI and the Column-Order Dialog

**Files:**
- Create: `apps/web/src/features/account-table-columns.tsx`
- Create: `apps/web/src/features/AccountColumnOrderDialog.tsx`
- Create: `apps/web/src/features/account-table-columns.test.tsx`
- Create: `apps/web/src/tests/account-column-order-dialog.test.tsx`
- Modify: `apps/web/src/features/AccountsPage.tsx`
- Modify: `apps/web/src/features/ImportsPage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/tests/accounts-page.test.tsx`
- Modify: `apps/web/src/tests/imports-page.test.tsx`
- Modify: `apps/web/src/tests/styles.test.ts`

**Interfaces:**
- Consumes: Task 1 shared columns/mobile and Task 3 account-column settings endpoints.
- Produces: `ACCOUNT_TABLE_COLUMNS` and `AccountColumnOrderDialog`.
- Preserves: fixed selection/index/actions, active-kind React Query isolation, batch behavior, direct passwords, and no overlay over the table outside explicit dialogs.

- [ ] **Step 1: Write failing table registry tests**

Assert a normalized order renders matching `col`, header, and cell IDs:

```ts
const columns = buildAccountTableColumns("email", ["remark", "mobile", "email", "douyin"]);
expect(columns.slice(0, 4).map((column) => column.id)).toEqual([
  "remark", "mobile", "email", "douyin"
]);
expect(columns.find((column) => column.id === "mobile")?.header).toBe("手机号");
```

Assert Google never produces Email, every descriptor has one CSS class, and mobile renders `—` for legacy empty values plus full `title` for a synthetic value.

- [ ] **Step 2: Run registry tests and verify RED**

Run: `pnpm --filter @douyin-admin/web test -- src/features/account-table-columns.test.tsx`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Create the focused table registry**

Define:

```tsx
export type AccountTableColumn = {
  id: AccountColumnId;
  header: string;
  className: string;
  render(row: AccountDto): ReactNode;
};

export type AccountTableColumnActions = {
  reveal(id: string): void;
  copyText(value: string, successMessage: string): void;
};

export function buildAccountTableColumns(
  accountKind: AccountKind,
  order: unknown,
  actions: AccountTableColumnActions
): AccountTableColumn[];
```

Move all business-column label/cell mapping out of `AccountsPage`. Keep the actual reveal/copy effects in the page and pass them through `AccountTableColumnActions`; the `opsecret` and `shortop` renderers call those actions. Fixed checkbox, sequence and row actions remain in `AccountsPage`. Do not duplicate an order array in the page.

- [ ] **Step 4: Write failing dialog interaction tests**

Render the dialog with Google order and assert:

- `选择框`, `序号`, and `操作` are absent from draggable rows;
- dragging `手机号` before `抖音号` calls `onChange` with the new stable-ID order;
- up/down buttons reorder one step and disable at boundaries;
- “恢复默认顺序” restores the current kind default;
- cancel does not call `onSave`;
- save calls `onSave(draft)` once and disables while `busy`;
- save failure text remains visible with the draft intact.

- [ ] **Step 5: Run dialog tests and verify RED**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/account-column-order-dialog.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement accessible drag/order controls**

Use native `draggable` rows with stable IDs and explicit keyboard/touch fallbacks:

```tsx
<li draggable onDragStart={() => setDragging(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveBefore(dragging, id)}>
  <button type="button" aria-label={`拖动${label}`} className="drag-handle">⋮⋮</button>
  <span>{label}</span>
  <button type="button" aria-label={`上移${label}`} onClick={() => moveBy(id, -1)}>↑</button>
  <button type="button" aria-label={`下移${label}`} onClick={() => moveBy(id, 1)}>↓</button>
</li>
```

Keep draft state local, reset it when the dialog opens for another kind, and call the supplied async save only from the Save button.

- [ ] **Step 7: Write failing AccountsPage mobile/order tests**

Extend the fixture DTO with `mobile`. Mock:

```ts
GET /api/settings/account-columns
// => {
//   google: ["douyin", "password", "secuid", "date", "opname", "opsecret", "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status", "remark"],
//   email: ["douyin", "email", "password", "secuid", "date", "opname", "opsecret", "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status", "remark"]
// }
PATCH /api/settings/account-columns/email
// body => { order: ["mobile", "douyin", "email", "password", "secuid", "date", "opname", "opsecret", "shortop", "project", "expiry", "owner", "region", "sale", "status", "remark"] }
```

Assert:

- both pages show `手机号` immediately after `短 OP` by default;
- Google has 18 total columns and Email has 19;
- row phone uses full `title` and legacy empty is `—`;
- create/edit for both kinds submit normalized `mobile`;
- invalid mobile shows the shared Chinese error and sends no save request;
- a saved Email reorder changes `colgroup`, header, and row cell order immediately;
- switching to Google uses its independent order;
- export payload contains no client-authoritative column list.

- [ ] **Step 8: Run AccountsPage tests and verify RED**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx`

Expected: FAIL because the page has no settings query, mobile field, or configurable renderer.

- [ ] **Step 9: Wire settings, table, and form**

Use query key `['account-column-orders']` for the GET response and mutation URL `/api/settings/account-columns/${accountKind}`. Select `orders[accountKind]`, normalize it, and render:

```tsx
<colgroup>
  <col className="col-check" />
  <col className="col-index" />
  {columns.map((column) => <col key={column.id} className={column.className} />)}
  <col className="col-actions" />
</colgroup>
```

Use the same `columns` array for headers and row cells; `colSpan` is `columns.length + 3`. Add `mobile` to blank/edit form state and submit value. Render one shared optional field on both kinds:

```tsx
<label>手机号
  <input name="mobile" defaultValue={state.value.mobile} maxLength={32} placeholder="+86 13037174892" />
</label>
```

Validate with shared `MobileSchema.safeParse`, display its Chinese error adjacent to the field, and block save on failure.

- [ ] **Step 10: Add phone-aware paste import and guide tests**

Change `buildPasteImportCsv` to accept the current normalized order and select importable IDs. Assert Google/Email paste headers include `手机号` at the saved relative position, a sample `+86 13037174892` survives CSV quoting, and existing date-override two-part lines remain date overrides rather than account imports.

The ImportsPage fetches the same `account-column-orders` query and uses the active kind order for the displayed paste guide, generated CSV, and template link behavior. It does not send order to the upload API.

- [ ] **Step 11: Rebalance CSS and write failing width rules**

Add `.col-mobile` and dialog styles. Adjust the existing column widths and both table minimums so the desktop target remains 1518px or less. Preserve `.table-scroll { overflow-x: auto }` for narrow screens. Tests assert:

```ts
expect(styles).toMatch(/\.accounts-table-email\s*\{[^}]*min-width:\s*1518px/);
expect(styles).toMatch(/\.accounts-table \.col-mobile\s*\{[^}]*width:/);
expect(styles).not.toMatch(/min-width:\s*1[6-9]\d{2}px/);
```

- [ ] **Step 12: Run all focused Web checks**

Run: `pnpm --filter @douyin-admin/web test -- src/features/account-table-columns.test.tsx src/tests/account-column-order-dialog.test.tsx src/tests/accounts-page.test.tsx src/tests/imports-page.test.tsx src/tests/styles.test.ts`

Run: `pnpm --filter @douyin-admin/web typecheck`

Run: `pnpm --filter @douyin-admin/web build`

Expected: PASS.

- [ ] **Step 13: Commit Task 5**

```bash
git add apps/web/src/features/account-table-columns.tsx apps/web/src/features/AccountColumnOrderDialog.tsx apps/web/src/features/account-table-columns.test.tsx apps/web/src/features/AccountsPage.tsx apps/web/src/features/ImportsPage.tsx apps/web/src/styles.css apps/web/src/tests/account-column-order-dialog.test.tsx apps/web/src/tests/accounts-page.test.tsx apps/web/src/tests/imports-page.test.tsx apps/web/src/tests/styles.test.ts
git commit -m "feat: add mobile and configurable account columns"
```

---

### Task 6: Full Regression and Rendered Verification

**Files:**
- Verify: every path changed by Tasks 1–5
- Preserve: original checkout user-owned APK and `.DS_Store` changes

**Interfaces:**
- Consumes: integrated shared, API, export/import, settings, and Web behavior.
- Produces: fresh evidence at the exact final commit.

- [ ] **Step 1: Run full automated verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `git diff --check`

Expected: all tests/typechecks/builds PASS and diff check prints nothing.

- [ ] **Step 2: Inspect scope and secret safety**

Run: `git status --short --branch`

Run: `git diff --stat 4f6dcf1...HEAD`

Run: `git diff 4f6dcf1...HEAD -- apps/api/src apps/web/src packages/shared/src | rg -n "console\\.|mobile|accountPassword|opSecret"`

Expected: only planned paths; mobile appears as schema/data/field-name handling, never as a logged value; no plaintext password or OP-secret logging.

- [ ] **Step 3: Start a controlled authenticated fixture**

Use synthetic Google/Email accounts with `+86 13000000000` and `+852 60000000`. Keep temporary fixture files and screenshots outside the repository. Record received settings PATCH, create/edit, import, export, and template requests without printing account-password or OP-secret values.

- [ ] **Step 4: Verify default layouts at 1920×1080**

Open `/accounts/google` and `/accounts/email` at 100% zoom. For each page assert:

- `手机号` is immediately after `短 OP`;
- Google has 18 total columns and Email has 19;
- the mobile cell title preserves the exact `+`/space value;
- `scrollWidth <= clientWidth`;
- password, mobile, Email-only email, statuses, and actions remain visible together;
- no framework overlay or relevant console warning/error.

Save screenshots under `/tmp`.

- [ ] **Step 5: Exercise independent server-persisted ordering**

On Email, open “表头设置”, drag `手机号` before `抖音号`, save, and verify header and row cells move together. Reload and verify the order persists. Open Google and verify its default remains unchanged. Reorder Google with an up/down button, reload, then restore both defaults and verify mobile returns after `短 OP`.

- [ ] **Step 6: Exercise mobile validation and import/export order**

Verify `+86 13037174892` saves while `86-13037174892` shows the Chinese error and sends no save request. Download selected and all CSV/XLSX exports after a synthetic custom order; inspect actual headers and values, and confirm the XLSX mobile cell is text. Download both templates and confirm `手机号` follows the saved relative order among importable columns. Upload a valid phone CSV and verify preview; upload an invalid phone CSV and verify a `mobile` row error.

- [ ] **Step 7: Verify narrow layout and fixed columns**

At 375×812 confirm five bottom navigation links stay on one row, the ordering dialog controls are usable, selection/index remain first, actions remain last, and only `.table-scroll` scrolls horizontally without an overlay.

- [ ] **Step 8: Record live-validation boundaries and branch state**

State separately whether real MongoDB, deployed administrator session, Excel delivery, and live Douyin/OP services were exercised. Confirm the implementation branch is clean and the original checkout still contains its pre-existing user-owned APK/`.DS_Store` changes untouched.
