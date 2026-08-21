# Account Status, Password, and Compact Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly distinguish banned and violating Douyin accounts during recheck, add an encrypted-at-rest account login password that is visibly rendered to the authenticated administrator, and fit the complete account table in a 1920×1080 desktop viewport without horizontal dragging.

**Architecture:** Keep status classification inside the existing Douyin response parser so create, single recheck, and batch recheck share one rule. Extend the shared account contract with `accountPassword`, persist only an optional encrypted value in MongoDB, and decrypt it only while building authenticated DTOs and exports. Keep the existing account page structure, but add a password field/column and apply a scoped fixed-width `colgroup` layout to the account table.

**Tech Stack:** TypeScript 5.8, Zod 4, Express 5, Mongoose 8, AES-256-GCM field encryption, React 19, TanStack Query 5, Vitest 3, Testing Library, Vite 7, pnpm 11.

## Global Constraints

- Use status priority: explicit banned evidence first, explicit violation evidence second, explicit normal evidence third, otherwise unknown.
- `ban_type === 1` or `punish_title === "账号已被封禁"` maps to `banned`.
- `ban_type === 2`, explicit violation title/content, or `is_punish === true` maps to `violation`.
- `is_ban === false` with no punishment maps to `normal`; `is_ban === true` without a discriminator maps to `unknown`.
- Preserve existing create, single recheck, batch recheck, OP recheck, selection, and 500-ID batch behavior.
- `accountPassword` is a Douyin account password, not the administrator password or OP card secret.
- Store a non-empty account password with the existing AES-256-GCM cipher; an empty password has no encrypted database field.
- Omitted password on update preserves the current password; an explicit empty string clears it.
- Show the decrypted account password directly in the authenticated account table without masking.
- Do not add passwords to `searchText`, logs, audit values, error responses, or unauthenticated endpoints.
- Keep historical records and old import files valid when no password exists.
- Desktop acceptance baseline: 1920×1080 viewport, browser zoom 100%, expanded sidebar, no horizontal drag required to see both password and action columns.
- Preserve all unrelated worktree changes; stage only files named in each task.

## File Structure

- `apps/api/src/services/douyin-check.ts`: owns third-party response parsing and the single account-status precedence rule.
- `apps/api/src/tests/douyin-check.test.ts`: protects banned, violation, normal, and ambiguous mappings.
- `packages/shared/src/account.ts`: owns input schemas, patch semantics, and authenticated DTO shape.
- `packages/shared/src/account.test.ts`: protects password validation/default behavior.
- `apps/api/src/models/account.ts`: owns the optional encrypted `accountPassword` database field and excludes it from search text.
- `apps/api/src/services/accounts.ts`: encrypts create/update values and decrypts authenticated DTOs.
- `apps/api/src/tests/accounts.service.test.ts`: protects encryption, update preserve/replace/clear behavior, and historical records.
- `apps/api/src/services/import-parser.ts`: maps the optional Chinese “密码” input column.
- `apps/api/src/services/exporter.ts`: emits decrypted password after 抖音号 and adds it to templates.
- `apps/api/src/tests/import-parser.test.ts`: protects imports with and without passwords.
- `apps/api/src/tests/exporter.test.ts`: protects exported/template column order and plaintext output.
- `apps/web/src/features/AccountsPage.tsx`: adds form state, direct password rendering, column classes, and the fixed `colgroup`.
- `apps/web/src/tests/accounts-page.test.tsx`: protects column order, visible password, empty fallback, and edit payloads.
- `apps/web/src/styles.css`: scopes compact account-table widths and action spacing.
- `apps/web/src/tests/styles.test.ts`: protects the desktop width budget without requiring fragile pixel screenshots in unit tests.

---

### Task 1: Correct Douyin Status Precedence

**Files:**
- Modify: `apps/api/src/tests/douyin-check.test.ts`
- Modify: `apps/api/src/services/douyin-check.ts`

**Interfaces:**
- Consumes: `parseDouyinResponse(value, now?)` and `parseDouyinProfileOtherResponse(value, now?)`.
- Produces: both functions return `DouyinCheckResult.accountStatus` using the shared precedence rule; no caller API changes.

- [ ] **Step 1: Replace the obsolete ban-type expectation and add ambiguous-signal coverage**

In `apps/api/src/tests/douyin-check.test.ts`, replace the test named `does not map ban_type=1 alone to banned` and add these cases:

```ts
it("maps ban_type=1 to banned before generic punishment signals", () => {
  const fixture = {
    status: 200,
    body: JSON.stringify({
      status_code: 0,
      user_info: {
        sec_uid: "MS4w-ban-type-1",
        is_ban: true,
        punish_remind_info: { is_punish: true, ban_type: 1 }
      }
    })
  };
  expect(parseDouyinResponse(fixture).accountStatus).toBe("banned");
});

it("maps ban_type=2 to violation", () => {
  const fixture = {
    status: 200,
    body: JSON.stringify({
      status_code: 0,
      user_info: {
        sec_uid: "MS4w-ban-type-2",
        is_ban: true,
        punish_remind_info: { ban_type: 2 }
      }
    })
  };
  expect(parseDouyinResponse(fixture).accountStatus).toBe("violation");
});

it("keeps an undiscriminated is_ban=true response unknown", () => {
  const fixture = {
    status: 200,
    body: JSON.stringify({
      status_code: 0,
      user_info: { sec_uid: "MS4w-ambiguous", is_ban: true }
    })
  };
  expect(parseDouyinResponse(fixture).accountStatus).toBe("unknown");
});
```

- [ ] **Step 2: Run the focused parser tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/douyin-check.test.ts
```

Expected: the `ban_type=1` case receives `violation`, and the ambiguous `is_ban=true` case receives `violation` instead of the required values.

- [ ] **Step 3: Implement the explicit precedence in `mapAccountStatus`**

Change `mapAccountStatus` in `apps/api/src/services/douyin-check.ts` to this decision order:

```ts
if (punishment?.ban_type === 1 || title === "账号已被封禁") return "banned";
if (
  punishment?.ban_type === 2 ||
  title === "违规处罚说明" ||
  content.includes("该用户被禁止关注") ||
  Boolean(title) ||
  punishment?.is_punish === true
) return "violation";
if (isBan === false || (isBan === undefined && punishment == null)) return "normal";
return "unknown";
```

Keep `title` and combined content normalization unchanged.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/douyin-check.test.ts
```

Expected: all Douyin parser and checker tests pass with zero failures.

- [ ] **Step 5: Commit the status fix**

```bash
git add apps/api/src/services/douyin-check.ts apps/api/src/tests/douyin-check.test.ts
git commit -m "fix: distinguish banned and violating accounts"
```

---

### Task 2: Add the Password Contract and Encrypted Persistence

**Files:**
- Modify: `packages/shared/src/account.test.ts`
- Modify: `packages/shared/src/account.ts`
- Modify: `apps/api/src/tests/models.test.ts`
- Modify: `apps/api/src/models/account.ts`
- Modify: `apps/api/src/tests/accounts.service.test.ts`
- Modify: `apps/api/src/services/accounts.ts`

**Interfaces:**
- Produces: optional `AccountInput.accountPassword?: string`; normalized `AccountDto.accountPassword: string`; `AccountRecord.accountPassword?: EncryptedValue`.
- Produces: `toDto(record, cipher)` decrypts an existing password or returns `""` for a historical record.
- Update contract: missing `accountPassword` preserves; `""` removes encrypted value; non-empty string encrypts and replaces.

- [ ] **Step 1: Add failing shared-schema tests**

Add to `packages/shared/src/account.test.ts`:

```ts
it("accepts an optional Douyin account password", () => {
  const base = {
    douyinId: "94946893573",
    registeredAt: "2026-07-27",
    opName: "",
    opSecret: "a|b|1782303418",
    owner: "小王",
    saleStatus: "unsold" as const,
    remark: ""
  };
  expect(AccountInputSchema.parse({ ...base, accountPassword: "douyin-pass" }).accountPassword)
    .toBe("douyin-pass");
  expect(AccountInputSchema.parse(base)).not.toHaveProperty("accountPassword");
});

it("rejects an account password longer than 4096 characters", () => {
  expect(() => AccountInputSchema.parse({
    douyinId: "94946893573",
    registeredAt: "2026-07-27",
    opSecret: "a|b|1782303418",
    owner: "小王",
    accountPassword: "x".repeat(4097)
  })).toThrow();
});
```

- [ ] **Step 2: Run the shared test and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/shared test -- src/account.test.ts
```

Expected: the strict schema rejects the supplied `accountPassword` field because it is not defined yet.

- [ ] **Step 3: Extend the shared input and DTO types**

In `packages/shared/src/account.ts`, add this administrator-entered field to `AccountInputSchema`:

```ts
accountPassword: z.string().max(4096).optional()
```

Add this decrypted field to the existing `AccountDto` object type:

```ts
accountPassword: string;
```

Do not add `accountPassword` to query schemas or status enums.

- [ ] **Step 4: Add failing model and service tests**

Extend `accountDocument()` in `apps/api/src/tests/accounts.service.test.ts` so individual tests can provide `accountPassword`. Define the controlled encrypted fixture and add tests that assert:

```ts
const encryptedPassword = {
  version: 1 as const,
  iv: "cGFzc3dvcmQtaXY=",
  ciphertext: "cGFzc3dvcmQtY2lwaGVydGV4dA==",
  authTag: "cGFzc3dvcmQtdGFn"
};

expect(create).toHaveBeenCalledWith(expect.objectContaining({
  accountPassword: encryptedPassword
}));
expect(result.accountPassword).toBe("douyin-pass");
expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("douyin-pass");
```

Add three update tests:

```ts
await service.update(id, { remark: "keep" }, context);
expect(account.accountPassword).toBe(encryptedPassword);

await service.update(id, { accountPassword: "replacement" }, context);
expect(deps.cipher.encrypt).toHaveBeenCalledWith("replacement");

await service.update(id, { accountPassword: "" }, context);
expect(account.accountPassword).toBeUndefined();
```

Add a historical-record test where `accountPassword` is absent and `result.accountPassword === ""`. In `apps/api/src/tests/models.test.ts`, assert that a model record accepts an encrypted `accountPassword` and that `searchText` does not contain the submitted plaintext password.

- [ ] **Step 5: Run focused persistence tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/models.test.ts src/tests/accounts.service.test.ts
```

Expected: model typing/schema and service DTO expectations fail because persistence is not implemented.

- [ ] **Step 6: Add optional encrypted storage and authenticated DTO decryption**

In `apps/api/src/models/account.ts`, add:

```ts
accountPassword?: EncryptedValue | undefined;
```

and the optional schema field:

```ts
accountPassword: { type: EncryptedValueSchema, required: false }
```

Do not include it in `AccountSchema.pre("validate")` search text construction.

In `apps/api/src/services/accounts.ts`, change the helper signature from `toDto(value)` to `toDto(value, cipher)`:

```ts
function toDto(
  value: AccountRecord & { _id: unknown },
  cipher: SecretCipher
): AccountDto
```

Add this property to the object already returned by that helper:

```ts
accountPassword: value.accountPassword
  ? cipher.decrypt(value.accountPassword)
  : ""
```

Pass `cipher` at every `toDto` call site. During create, destructure `accountPassword` away from the object that is persisted and write only encrypted content:

```ts
const { accountPassword, ...preparedFields } = prepared;
```

Spread `preparedFields` into the create payload and add this encrypted property after the spread:

```ts
accountPassword: accountPassword
  ? cipher.encrypt(accountPassword)
  : undefined
```

During update, handle the key before the generic assignment loop:

```ts
if ("accountPassword" in patch) {
  account.accountPassword = patch.accountPassword
    ? cipher.encrypt(patch.accountPassword)
    : undefined;
}
```

Skip `accountPassword` in the generic assignment loop. Keep only the field name in `changedFields`; never pass its value to audit logging.

- [ ] **Step 7: Run shared, model, and service tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/shared test -- src/account.test.ts
pnpm --filter @douyin-admin/api test -- src/tests/models.test.ts src/tests/accounts.service.test.ts
```

Expected: all selected tests pass, including preserve/replace/clear and historical-record cases.

- [ ] **Step 8: Commit the password contract and persistence**

```bash
git add packages/shared/src/account.ts packages/shared/src/account.test.ts apps/api/src/models/account.ts apps/api/src/tests/models.test.ts apps/api/src/services/accounts.ts apps/api/src/tests/accounts.service.test.ts
git commit -m "feat: store Douyin account passwords securely"
```

---

### Task 3: Carry Passwords Through Import and Export

**Files:**
- Modify: `apps/api/src/tests/import-parser.test.ts`
- Modify: `apps/api/src/services/import-parser.ts`
- Modify: `apps/api/src/tests/exporter.test.ts`
- Modify: `apps/api/src/services/exporter.ts`

**Interfaces:**
- Consumes: `AccountInput.accountPassword` and `AccountRecord.accountPassword` from Task 2.
- Produces: import column `密码`; export order begins `抖音号,密码,sec_uid`; import template begins `抖音号,密码,注册时间`.

- [ ] **Step 1: Add failing import tests for present and missing password columns**

Add to `apps/api/src/tests/import-parser.test.ts`:

```ts
it("imports the optional 密码 column", () => {
  const result = parseImport(workbookBuffer([{
    抖音号: "94946893573",
    密码: "douyin-pass",
    注册时间: "2026-07-27",
    OP卡密: "a|b|1782303418",
    归属人: "小王"
  }]), "accounts.xlsx");
  expect(result.rows[0]?.accountPassword).toBe("douyin-pass");
  expect(result.errors).toEqual([]);
});

it("defaults old import files without 密码 to an empty password", () => {
  const result = parseImport(workbookBuffer([{
    抖音号: "94946893573",
    注册时间: "2026-07-27",
    OP卡密: "a|b|1782303418",
    归属人: "小王"
  }]), "accounts.xlsx");
  expect(result.rows[0]?.accountPassword).toBe("");
});
```

- [ ] **Step 2: Add failing export and template tests**

In `apps/api/src/tests/exporter.test.ts`, provide an encrypted `accountPassword` fixture and make the cipher return `douyin-pass` only for that encrypted value. Assert:

```ts
expect(Object.keys(rows[0] ?? {}).slice(0, 3)).toEqual([
  "抖音号", "密码", "sec_uid"
]);
expect(rows[0]?.["密码"]).toBe("douyin-pass");
expect(exportTemplate("csv").toString("utf8"))
  .toContain("抖音号,密码,注册时间");
```

Add a second export fixture without `accountPassword` and assert its password cell is empty.

- [ ] **Step 3: Run import/export tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/exporter.test.ts
```

Expected: password import/export assertions fail and the template lacks the new column.

- [ ] **Step 4: Implement password column mapping**

In `apps/api/src/services/import-parser.ts`, add to the candidate passed to `AccountInputSchema`:

```ts
accountPassword: String(source["密码"] ?? "").trim()
```

In `apps/api/src/services/exporter.ts`, place this property immediately after `抖音号`:

```ts
密码: account.accountPassword
  ? cipher.decrypt(account.accountPassword)
  : ""
```

Insert `密码` immediately after `抖音号` in `exportTemplate`. Replace the XLSX text-column calls with these exact indexes for 抖音号, 密码, `sec_uid`, 注册时间, and 短 OP:

```ts
markColumnAsText(sheet, 0, rows.length);
markColumnAsText(sheet, 1, rows.length);
markColumnAsText(sheet, 2, rows.length);
markColumnAsText(sheet, 3, rows.length);
markColumnAsText(sheet, 6, rows.length);
```

- [ ] **Step 5: Run import/export tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api test -- src/tests/import-parser.test.ts src/tests/exporter.test.ts
```

Expected: all import/export tests pass with the exact new column order.

- [ ] **Step 6: Commit import/export support**

```bash
git add apps/api/src/services/import-parser.ts apps/api/src/tests/import-parser.test.ts apps/api/src/services/exporter.ts apps/api/src/tests/exporter.test.ts
git commit -m "feat: import and export account passwords"
```

---

### Task 4: Render and Edit the Visible Password

**Files:**
- Modify: `apps/web/src/tests/accounts-page.test.tsx`
- Modify: `apps/web/src/features/AccountsPage.tsx`

**Interfaces:**
- Consumes: `AccountDto.accountPassword` and `AccountInput.accountPassword` from Task 2.
- Produces: password column after 抖音号, unmasked cell text, labeled drawer input, and update payload semantics.

- [ ] **Step 1: Extend fixtures and add failing UI assertions**

Add `accountPassword` to `accountFixture()` and the explicit account fixtures in `apps/web/src/tests/accounts-page.test.tsx`. Update the column-header assertion to:

```ts
[
  "", "序号", "抖音号", "密码", "sec_uid", "注册时间", "OP名称",
  "OP卡密", "短 OP", "项目", "OP到期时间", "归属人", "注册地区",
  "售卖状态", "账号状态", "备注", "操作"
]
```

Add a test with two rows:

```ts
expect(await screen.findByText("douyin-pass-1")).toBeVisible();
expect(screen.queryByText("••••••", { selector: ".account-password-cell" }))
  .not.toBeInTheDocument();
expect(secondRow.querySelector(".account-password-cell")).toHaveTextContent("—");
```

In the existing create/edit test, assert the drawer has a text input labeled `密码`, create submits the typed value, edit is prefilled from `row.accountPassword`, and clearing it submits `accountPassword: ""`.

- [ ] **Step 2: Run the page test and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx
```

Expected: column-order and password-input assertions fail.

- [ ] **Step 3: Add password form state and direct table rendering**

In `apps/web/src/features/AccountsPage.tsx`, add this property to the current `blank` object:

```ts
accountPassword: ""
```

Populate `accountPassword: row.accountPassword` when opening edit. Change the submit type so the password can be omitted from an unchanged edit:

```ts
type AccountSubmitValue = Omit<
  AccountFormValue,
  "opSecret" | "accountPassword"
> & {
  opSecret?: string;
  accountPassword?: string;
};
```

Read the password from `FormData`. Include it for create, and include it for edit only when its value differs from `state.value.accountPassword`:

```ts
const accountPassword = String(d.get("accountPassword") ?? "");
if (state.mode === "create" || accountPassword !== state.value.accountPassword) {
  value.accountPassword = accountPassword;
}
```

Add a normal text input, not `type="password"`:

```tsx
<label>
  密码
  <input name="accountPassword" defaultValue={state.value.accountPassword} maxLength={4096} />
</label>
```

Insert the header after 抖音号 and render:

```tsx
<td className="account-password-cell" title={row.accountPassword || undefined}>
  {row.accountPassword || "—"}
</td>
```

Increase loading/empty `colSpan` from 16 to 17.

- [ ] **Step 4: Run the page test and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/accounts-page.test.tsx
```

Expected: all account-page interaction tests pass with direct password text and unchanged recheck behavior.

- [ ] **Step 5: Commit visible password UI**

```bash
git add apps/web/src/features/AccountsPage.tsx apps/web/src/tests/accounts-page.test.tsx
git commit -m "feat: show account passwords in the admin table"
```

---

### Task 5: Fit the Account Table to the Desktop Width Budget

**Files:**
- Modify: `apps/web/src/tests/styles.test.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/features/AccountsPage.tsx`

**Interfaces:**
- Consumes: the 17-column table from Task 4.
- Produces: `.accounts-table` with fixed layout and semantic column classes; minimum width no greater than 1420px.

- [ ] **Step 1: Replace the old forced-scroll style test with a desktop budget test**

Change the existing expanded-table test in `apps/web/src/tests/styles.test.ts` to assert scoped behavior:

```ts
it("keeps the account table within the 1920 desktop content budget", () => {
  const accountTableRule =
    styles.match(/\.accounts-table\s*\{[^}]+\}/)?.[0] ?? "";
  const actionsRule =
    styles.match(/\.accounts-table \.actions\s*\{[^}]+\}/)?.[0] ?? "";

  expect(accountTableRule).toContain("table-layout: fixed;");
  expect(accountTableRule).toContain("min-width: 1410px;");
  expect(accountTableRule).not.toContain("1720px");
  expect(actionsRule).toContain("gap: 3px;");
});
```

Keep the checkbox clipping assertion as a separate test.

- [ ] **Step 2: Add a failing DOM test for semantic columns and truncation titles**

In `apps/web/src/tests/accounts-page.test.tsx`, assert that the rendered table has class `accounts-table`, contains a `colgroup` with 17 `col` elements, and long `sec_uid`, password, OP name, and remark cells retain a `title` attribute with the complete value.

- [ ] **Step 3: Run focused web tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/styles.test.ts src/tests/accounts-page.test.tsx
```

Expected: `.accounts-table`, compact action spacing, `colgroup`, and title assertions fail.

- [ ] **Step 4: Implement the scoped width budget and column classes**

In `AccountsPage.tsx`, add `className="accounts-table"` and this 17-column structure before `<thead>`:

```tsx
<colgroup>
  {[
    "check", "index", "douyin", "password", "secuid", "date", "opname",
    "opsecret", "shortop", "project", "expiry", "owner", "region",
    "sale", "status", "remark", "actions"
  ].map((name) => <col key={name} className={`col-${name}`} />)}
</colgroup>
```

Add `title` attributes to long-content cells and keep all text on one line. In `apps/web/src/styles.css`, remove `min-width: 1720px` from the global `table` rule and add:

```css
.accounts-table { min-width: 1410px; table-layout: fixed; }
.accounts-table th,
.accounts-table td { padding-inline: 6px; }
.accounts-table .col-check { width: 38px; }
.accounts-table .col-index { width: 42px; }
.accounts-table .col-douyin { width: 94px; }
.accounts-table .col-password { width: 88px; }
.accounts-table .col-secuid { width: 112px; }
.accounts-table .col-date { width: 82px; }
.accounts-table .col-opname { width: 72px; }
.accounts-table .col-opsecret { width: 66px; }
.accounts-table .col-shortop { width: 132px; }
.accounts-table .col-project { width: 50px; }
.accounts-table .col-expiry { width: 122px; }
.accounts-table .col-owner { width: 62px; }
.accounts-table .col-region { width: 70px; }
.accounts-table .col-sale { width: 74px; }
.accounts-table .col-status { width: 64px; }
.accounts-table .col-remark { width: 70px; }
.accounts-table .col-actions { width: 172px; }
.accounts-table .short-op-cell { min-width: 0; }
.accounts-table .actions { gap: 3px; }
.accounts-table .actions .link { font-size: 12px; }
```

The widths sum below 1420px while retaining the existing overflow container for narrower windows.

- [ ] **Step 5: Run focused web tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/styles.test.ts src/tests/accounts-page.test.tsx
```

Expected: style-contract and account-page tests pass.

- [ ] **Step 6: Commit the compact table layout**

```bash
git add apps/web/src/styles.css apps/web/src/tests/styles.test.ts apps/web/src/features/AccountsPage.tsx apps/web/src/tests/accounts-page.test.tsx
git commit -m "style: fit account columns in desktop view"
```

---

### Task 6: Full Regression and Rendered Browser Verification

**Files:**
- Modify only if a verification failure reveals a task-scoped defect: files already listed in Tasks 1–5.
- Do not write screenshots, traces, or temporary browser scripts into the repository.

**Interfaces:**
- Consumes: all behavior delivered by Tasks 1–5.
- Produces: fresh test/build evidence and rendered 1920×1080 evidence for the final report.

- [ ] **Step 1: Run the complete automated verification suite**

Run each command and require exit code 0:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: zero failed tests, zero TypeScript errors, successful recursive build, and no whitespace errors.

- [ ] **Step 2: Inspect the final change scope and secret exposure boundaries**

Run:

```bash
git status --short
git diff --stat e2438fa..HEAD
git diff e2438fa..HEAD -- packages/shared/src/account.ts apps/api/src/models/account.ts apps/api/src/services/accounts.ts apps/api/src/services/exporter.ts apps/web/src/features/AccountsPage.tsx apps/web/src/styles.css
```

Confirm manually from the diff that plaintext passwords occur only in authenticated DTO/UI/export values, not model fixtures committed as real credentials, logs, `searchText`, audit values, or public routes. Confirm unrelated APK and `.DS_Store` changes remain untouched.

- [ ] **Step 3: Load and follow the in-app Browser skill before browser actions**

Read `browser:control-in-app-browser` completely. Use its Node/browser runtime, name the session, reuse one tab, and do not fall back to a separate browser path unless the Browser runtime itself fails and fallback is explicitly permitted.

- [ ] **Step 4: Start the real app surface and define the target flow**

Prefer the existing Docker deployment at `http://127.0.0.1:18080/accounts`. If it is not running, use the repository’s documented Docker Compose command with its existing `.env`; do not replace credentials. The flow under test is:

```text
/accounts -> inspect password and status columns -> select or click single recheck -> observe refreshed banned/violation status while the action column remains visible without horizontal dragging
```

- [ ] **Step 5: Verify the 1920×1080 rendered state**

At viewport 1920×1080 and zoom 100%, collect:

- URL and title identity.
- A non-empty DOM snapshot with the account table.
- No Vite/React/framework error overlay.
- Console errors and warnings, explaining any unrelated pre-existing entry.
- `table.scrollWidth <= table.clientWidth` or, if borders cause rounding, a difference no greater than 2px.
- Visible `密码` and `操作` headers in the same viewport.
- Direct plaintext password text for a controlled test record and `—` for a record without a password.
- Distinct “封禁” and “违规” labels from controlled data.
- A screenshot stored outside the repository.

- [ ] **Step 6: Exercise the recheck interaction**

Click a row’s `重新检测` icon, verify the progress notice appears, wait for the request to settle, and verify the refreshed row shows the expected status. If the third-party endpoint is unavailable, record that limitation and use the service/parser tests as the status proof; do not claim a live third-party result.

- [ ] **Step 7: Re-run affected checks after any browser-discovered fix**

If rendered QA required a code correction, first add a failing automated regression test, verify it fails, apply the minimal fix, and rerun:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/styles.test.ts src/tests/accounts-page.test.tsx
pnpm typecheck
pnpm build
git diff --check
```

Commit only the regression test and fix with:

```bash
git add apps/web/src/features/AccountsPage.tsx apps/web/src/tests/accounts-page.test.tsx apps/web/src/styles.css apps/web/src/tests/styles.test.ts
git commit -m "fix: correct compact account table rendering"
```

- [ ] **Step 8: Prepare the final QA report**

Report the user-visible changes, exact commands and pass counts, Browser availability, URL and viewport, screenshot evidence, recheck interaction result, and remaining unverified third-party or production-data layers. Do not claim Docker, MongoDB, or live Douyin behavior unless it was actually exercised in this run.
