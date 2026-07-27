# Douyin Account Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-deployable single-admin Douyin account management system with MongoDB persistence, live `sec_uid` and account-status detection, encrypted OP secrets, bulk import/export, and audit logs.

**Architecture:** Use a pnpm TypeScript monorepo with `apps/web`, `apps/api`, and `packages/shared`. Nginx serves the React build and proxies `/api` to Express; Express owns authentication, validation, Douyin API calls, field encryption, import jobs, and MongoDB access. MongoDB stores accounts, server-side sessions, import jobs, temporary import previews, audit logs, and settings.

**Tech Stack:** React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Express, Mongoose, express-session, connect-mongo, SheetJS, Vitest, Testing Library, Supertest, Playwright, Nginx, Docker Compose, MongoDB

## Global Constraints

- Use the approved light “A · compact sidebar” layout and keep the account data as a table, including at narrow widths.
- Keep sale status and account status independent.
- Sale status values are exactly `未售卖`, `已售卖`, `已停用`, and `已找回`.
- Account status values are exactly `正常`, `违规`, and `封禁`.
- Derive `sec_uid` and account status from `https://unid.tztright.top/check?num={douyinId}` on the server.
- Map `punish_remind_info.ban_type === 1` to `封禁`, `ban_type === 2` to `违规`, and no punishment plus `is_ban === false` to `正常`; unknown payloads are detection failures.
- Parse the final OP-secret segment as a 10-digit Unix timestamp and add exactly 5,184,000 seconds.
- Store timestamps as UTC and render them in `Asia/Shanghai`.
- Encrypt OP secrets with authenticated field-level encryption and never log full secrets, session tokens, or full `sec_uid` values.
- Only the web container exposes a host port; API and MongoDB remain on the private Compose network.
- MongoDB uses authentication and a named persistent volume.
- Import accepts `.xlsx`, `.xls`, and `.csv`, with a maximum of 10 MB and 10,000 rows.
- Preserve `.superpowers/` as an untracked local design artifact.

## File Map

```text
.
├── .env.example                    # Required deployment settings without secrets
├── .gitignore                      # Generated files, env files, and design artifacts
├── docker-compose.yml              # web, api, and mongo services
├── package.json                    # pnpm workspace scripts
├── pnpm-workspace.yaml             # Workspace package discovery
├── tsconfig.base.json              # Shared TypeScript compiler options
├── apps/
│   ├── api/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app.ts              # Express middleware and route composition
│   │       ├── server.ts           # Mongo connection, worker start, graceful shutdown
│   │       ├── config.ts           # Strict environment parsing
│   │       ├── middleware/         # Auth, errors, rate limits, request IDs
│   │       ├── models/             # Account, AuditLog, ImportJob, ImportPreview, Setting
│   │       ├── routes/             # Auth, accounts, imports, exports, logs, settings
│   │       ├── services/           # Encryption, detection, expiry, imports, exports, audits
│   │       └── tests/              # Unit, route, and integration tests
│   └── web/
│       ├── Dockerfile
│       ├── nginx.conf
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── app/                # Router, providers, protected shell
│           ├── components/         # UI primitives and shared admin components
│           ├── features/           # auth, accounts, imports, logs, settings
│           ├── styles/             # Accepted design tokens and global styles
│           └── tests/              # Component and integration tests
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/                    # Shared schemas, DTOs, enums, and labels
└── e2e/                            # Playwright browser workflows
```

---

### Task 1: Workspace and Shared Contracts

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/account.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/account.test.ts`

**Interfaces:**
- Produces: `SaleStatusSchema`, `AccountStatusSchema`, `AccountInputSchema`, `AccountDto`, `AccountListQuerySchema`, `PagedResponse<T>`, and Chinese status-label maps.

- [ ] **Step 1: Add workspace manifests and ignore rules**

Create workspace scripts for `build`, `test`, `lint`, `typecheck`, and `dev`. Ignore `.env`, `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, and `.superpowers/`; do not ignore `.env.example`.

```json
{
  "name": "douyin-account-admin",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 2: Write failing shared-schema tests**

```ts
import { describe, expect, it } from "vitest";
import { AccountInputSchema } from "./account";

describe("AccountInputSchema", () => {
  it("accepts only administrator-entered fields", () => {
    const value = AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    });
    expect(value.douyinId).toBe("94946893573");
  });

  it("rejects an unknown sale status", () => {
    expect(() => AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "normal",
      remark: ""
    })).toThrow();
  });
});
```

- [ ] **Step 3: Run the shared tests and verify failure**

Run: `pnpm --filter @douyin-admin/shared test`

Expected: FAIL because `AccountInputSchema` is not exported.

- [ ] **Step 4: Implement exact shared schemas and DTOs**

```ts
export const SALE_STATUSES = ["unsold", "sold", "disabled", "recovered"] as const;
export const ACCOUNT_STATUSES = ["normal", "violation", "banned"] as const;
export const SaleStatusSchema = z.enum(SALE_STATUSES);
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES);

export const AccountInputSchema = z.object({
  douyinId: z.string().trim().regex(/^\d+$/).max(32),
  registeredAt: z.iso.date(),
  opName: z.string().trim().max(100).default(""),
  opSecret: z.string().min(1).max(4096),
  owner: z.string().trim().min(1).max(100),
  saleStatus: SaleStatusSchema.default("unsold"),
  remark: z.string().trim().max(1000).default("")
}).strict();
```

Define `AccountDto` with `_id`, entered fields excluding `opSecret`, masked secret metadata, `secUid`, `opExpiresAt`, `accountStatus`, `accountCheckedAt`, `createdAt`, and `updatedAt`.

- [ ] **Step 5: Run shared validation**

Run: `pnpm --filter @douyin-admin/shared test && pnpm --filter @douyin-admin/shared typecheck`

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json pnpm-workspace.yaml tsconfig.base.json packages/shared
git commit -m "chore: initialize typed workspace contracts"
```

---

### Task 2: API Configuration, OP Expiry, and Field Encryption

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/services/op-expiry.ts`
- Create: `apps/api/src/services/encryption.ts`
- Test: `apps/api/src/tests/op-expiry.test.ts`
- Test: `apps/api/src/tests/encryption.test.ts`
- Test: `apps/api/src/tests/config.test.ts`

**Interfaces:**
- Consumes: shared account field limits.
- Produces: `loadConfig(env): AppConfig`, `calculateOpExpiry(secret): Date`, `encryptSecret(value): EncryptedValue`, and `decryptSecret(value): string`.

- [ ] **Step 1: Write expiry tests from the approved example**

```ts
describe("calculateOpExpiry", () => {
  it("adds exactly 5,184,000 seconds to the final pipe segment", () => {
    expect(calculateOpExpiry("a|b|1782303418").toISOString())
      .toBe("2026-08-23T12:16:58.000Z");
  });

  it.each(["a|b|", "a|b|178230341", "a|b|1782303418000", "a|b|not-time"])(
    "rejects invalid final timestamp %s",
    (secret) => expect(() => calculateOpExpiry(secret)).toThrow("OP_SECRET_TIMESTAMP_INVALID")
  );
});
```

- [ ] **Step 2: Run expiry tests and verify failure**

Run: `pnpm --filter @douyin-admin/api test -- op-expiry.test.ts`

Expected: FAIL because `calculateOpExpiry` does not exist.

- [ ] **Step 3: Implement strict OP expiry**

```ts
const SIXTY_DAYS_SECONDS = 5_184_000;

export function calculateOpExpiry(secret: string): Date {
  const last = secret.slice(secret.lastIndexOf("|") + 1);
  if (!/^\d{10}$/.test(last)) throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  const sourceSeconds = Number(last);
  const expires = new Date((sourceSeconds + SIXTY_DAYS_SECONDS) * 1000);
  if (Number.isNaN(expires.getTime())) throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  return expires;
}
```

- [ ] **Step 4: Write encryption and tamper tests**

Test AES-256-GCM round trips Unicode text, uses a different IV on repeated encryption, and rejects changed ciphertext or auth tags. Define:

```ts
type EncryptedValue = {
  version: 1;
  iv: string;
  ciphertext: string;
  authTag: string;
};
```

- [ ] **Step 5: Implement encryption and strict config**

Decode `FIELD_ENCRYPTION_KEY` as exactly 32 bytes from base64. Parse required environment variables with Zod, require `SESSION_SECRET` to be at least 32 characters, parse `DOUYIN_CHECK_API_URL` as HTTPS, and expose `cookieSecure`, `sessionHours`, and `mongoUri`.

- [ ] **Step 6: Run API unit tests**

Run: `pnpm --filter @douyin-admin/api test -- op-expiry.test.ts encryption.test.ts config.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): add secure config and secret derivations"
```

---

### Task 3: Douyin Detection Client

**Files:**
- Create: `apps/api/src/services/douyin-check.ts`
- Create: `apps/api/src/tests/fixtures/douyin-normal.json`
- Create: `apps/api/src/tests/fixtures/douyin-banned.json`
- Create: `apps/api/src/tests/fixtures/douyin-violation.json`
- Test: `apps/api/src/tests/douyin-check.test.ts`

**Interfaces:**
- Produces: `parseDouyinResponse(value): DouyinCheckResult` and `checkDouyinId(douyinId, signal?): Promise<DouyinCheckResult>`.
- `DouyinCheckResult`: `{ secUid: string; accountStatus: "normal" | "violation" | "banned"; checkedAt: Date }`.

- [ ] **Step 1: Save minimized fixtures from the three verified payload shapes**

Keep only `status`, outer `body`, inner `status_code`, `user_info.sec_uid`, `user_info.is_ban`, and `user_info.punish_remind_info`. Do not store response headers, avatar URLs, or unrelated personal profile data.

- [ ] **Step 2: Write failing mapping tests**

```ts
it.each([
  ["normal", normalFixture, "normal"],
  ["banned", bannedFixture, "banned"],
  ["violation", violationFixture, "violation"]
])("maps %s payload", (_name, fixture, expected) => {
  expect(parseDouyinResponse(fixture).accountStatus).toBe(expected);
});

it("rejects unknown punishment instead of guessing", () => {
  const fixture = makeFixture({ is_punish: true, ban_type: 99 });
  expect(() => parseDouyinResponse(fixture)).toThrow("DOUYIN_STATUS_UNKNOWN");
});
```

- [ ] **Step 3: Run mapping tests and verify failure**

Run: `pnpm --filter @douyin-admin/api test -- douyin-check.test.ts`

Expected: FAIL because the parser is missing.

- [ ] **Step 4: Implement the double-JSON parser and priority mapping**

Require outer `status === 200`, parse string `body`, require inner `status_code === 0`, validate `sec_uid`, then map `ban_type` before considering `is_ban`. Do not treat `is_ban === true` by itself as `banned`.

- [ ] **Step 5: Implement timeout and retry**

Use a 10-second `AbortSignal.timeout`, retry one time only for timeout, connection reset, or HTTP 5xx, and never retry schema or mapping failures. URL-encode the Douyin ID with `URL.searchParams`.

- [ ] **Step 6: Test transport behavior**

Mock `fetch` and assert one success request, two timeout requests, no retry for an unknown status payload, and no full body in thrown error messages.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/douyin-check.ts apps/api/src/tests
git commit -m "feat(api): detect douyin identity and account status"
```

---

### Task 4: Mongo Models and Audit Service

**Files:**
- Create: `apps/api/src/models/account.ts`
- Create: `apps/api/src/models/audit-log.ts`
- Create: `apps/api/src/models/import-job.ts`
- Create: `apps/api/src/models/import-preview.ts`
- Create: `apps/api/src/models/setting.ts`
- Create: `apps/api/src/services/audit.ts`
- Create: `apps/api/src/tests/mongo.ts`
- Test: `apps/api/src/tests/models.test.ts`
- Test: `apps/api/src/tests/audit.test.ts`

**Interfaces:**
- Consumes: `EncryptedValue`, `SaleStatus`, `AccountStatus`.
- Produces: Mongoose models and `writeAudit(event): Promise<void>`.

- [ ] **Step 1: Write model tests**

Start an isolated Mongo test database. Assert unique `douyinId` and `secUid`, enum validation, indexed searchable fields, encrypted OP-secret shape, required `opExpiresAt`, and TTL deletion metadata on `ImportPreview.expiresAt`.

- [ ] **Step 2: Run model tests and verify failure**

Run: `pnpm --filter @douyin-admin/api test -- models.test.ts`

Expected: FAIL because models do not exist.

- [ ] **Step 3: Implement Account and indexes**

Account fields are:

```ts
{
  douyinId: string;
  secUid: string;
  registeredAt: Date;
  opName: string;
  opSecret: EncryptedValue;
  opExpiresAt: Date;
  owner: string;
  saleStatus: SaleStatus;
  accountStatus: AccountStatus;
  accountCheckedAt: Date;
  remark: string;
  searchText: string;
}
```

Build `searchText` from lowercased `douyinId`, `secUid`, `opName`, `owner`, and `remark`, while keeping regex input escaped in query code.

- [ ] **Step 4: Implement audit and import models**

`AuditLog` stores action, target type, target IDs, count, changed field names, request IP, sanitized User-Agent, request ID, and timestamp. It never stores before/after secret values or full `secUid`.

`ImportPreview` stores encrypted staged rows, row errors, owner session ID, and a 30-minute TTL. `ImportJob` stores progress counts and status `queued | running | completed | failed`.

- [ ] **Step 5: Test audit redaction**

Pass an event containing `opSecret`, `secUid`, and `cookie`; verify the saved document contains field names only and none of the sensitive values.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/models apps/api/src/services/audit.ts apps/api/src/tests
git commit -m "feat(api): add persistent account and audit models"
```

---

### Task 5: Authentication and API Foundation

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/middleware/errors.ts`
- Create: `apps/api/src/middleware/request-id.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/app.ts`
- Test: `apps/api/src/tests/auth.routes.test.ts`
- Test: `apps/api/src/tests/app-security.test.ts`

**Interfaces:**
- Produces: `createApp(deps): Express`, `requireAdmin`, and authenticated `req.session.admin`.

- [ ] **Step 1: Write failing authentication route tests**

Test invalid credentials return 401 without revealing which field failed, valid credentials set an HttpOnly SameSite cookie, `/api/auth/session` returns 401 before login and 200 after login, and logout destroys the server-side session.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm --filter @douyin-admin/api test -- auth.routes.test.ts`

Expected: FAIL because `createApp` is missing.

- [ ] **Step 3: Implement server-side sessions**

Use `express-session` with `connect-mongo`, a signed cookie named `douyin_admin_session`, `httpOnly: true`, `sameSite: "lax"`, configured `secure`, fixed max age, `saveUninitialized: false`, and `resave: false`. Compare credentials with constant-time buffers of equal length.

- [ ] **Step 4: Add login rate limiting and security middleware**

Limit login attempts by IP plus normalized username, cap JSON bodies, set secure response headers, create request IDs, and normalize errors to:

```ts
type ApiErrorBody = {
  error: { code: string; message: string; fieldErrors?: Record<string, string> };
  requestId: string;
};
```

- [ ] **Step 5: Verify security behavior**

Run: `pnpm --filter @douyin-admin/api test -- auth.routes.test.ts app-security.test.ts`

Expected: all tests pass, including protected-route and oversized-body cases.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add single-admin session authentication"
```

---

### Task 6: Account CRUD, Search, Statistics, and Rechecks

**Files:**
- Create: `apps/api/src/services/accounts.ts`
- Create: `apps/api/src/routes/accounts.ts`
- Test: `apps/api/src/tests/accounts.service.test.ts`
- Test: `apps/api/src/tests/accounts.routes.test.ts`

**Interfaces:**
- Consumes: `checkDouyinId`, `calculateOpExpiry`, `encryptSecret`, `decryptSecret`, Account model, and audit service.
- Produces: all account endpoints and paged account DTOs.

- [ ] **Step 1: Write failing create-account service tests**

Assert create requires a successful Douyin check, ignores client-supplied `secUid`, `accountStatus`, and `opExpiresAt`, encrypts `opSecret`, and stores calculated values. Assert duplicate Douyin ID and duplicate `secUid` return distinct conflict codes.

- [ ] **Step 2: Implement create and update**

On create, validate entered fields, check Douyin ID, calculate expiry, encrypt secret, save, and audit. On update, only recheck when `douyinId` changes or the user explicitly requests recheck; only recalculate expiry when `opSecret` changes.

- [ ] **Step 3: Write and implement list tests**

Test server pagination, stable default sort `createdAt desc, _id desc`, escaped keyword search, sale/account/date filters, configurable page size, and statistics counts. Return masked secret state and never return ciphertext.

- [ ] **Step 4: Implement reveal, copy-data DTO, delete, and batch update**

Require a fresh authenticated session for reveal. Batch update accepts only `saleStatus` and `owner`; batch delete requires explicit IDs. Both cap IDs per request and write one summary audit record.

- [ ] **Step 5: Implement single and batch recheck**

Use a concurrency limit of 5. For each successful response update `secUid`, `accountStatus`, and `accountCheckedAt`; for failures preserve all previous successful values and return per-ID failure reasons.

- [ ] **Step 6: Run account tests**

Run: `pnpm --filter @douyin-admin/api test -- accounts.service.test.ts accounts.routes.test.ts`

Expected: all CRUD, sensitive-field, mapping, batch, and audit tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/accounts.ts apps/api/src/routes/accounts.ts apps/api/src/tests
git commit -m "feat(api): add account management endpoints"
```

---

### Task 7: Import Preview, Async Execution, and Export

**Files:**
- Create: `apps/api/src/services/import-parser.ts`
- Create: `apps/api/src/services/import-worker.ts`
- Create: `apps/api/src/services/exporter.ts`
- Create: `apps/api/src/routes/imports.ts`
- Create: `apps/api/src/routes/exports.ts`
- Test: `apps/api/src/tests/import-parser.test.ts`
- Test: `apps/api/src/tests/import-worker.test.ts`
- Test: `apps/api/src/tests/export.routes.test.ts`

**Interfaces:**
- Produces: `parseImport(buffer, mimeType)`, `startImportWorker(deps)`, preview/job routes, and streamed export routes.

- [ ] **Step 1: Write parser tests with in-memory workbook fixtures**

Cover Chinese headers, CSV UTF-8 BOM, optional OP name, invalid dates, invalid sale status, duplicate Douyin IDs within the file, more than 10,000 rows, and invalid OP timestamps.

- [ ] **Step 2: Implement file limits and normalized parsing**

Reject files above 10 MB before parsing. Accept only `.xlsx`, `.xls`, and `.csv`. Map exactly:

```text
抖音号, 注册时间, OP名称, OP卡密, 归属人, 售卖状态, 备注
```

Do not accept imported `sec_uid`, account status, or OP expiry as authoritative fields.

- [ ] **Step 3: Implement preview storage**

Encrypt every staged OP secret before writing `ImportPreview`, bind the preview to the current session, set a 30-minute TTL, and return only preview rows with masked secrets plus validation counts.

- [ ] **Step 4: Write worker tests**

Assert `skip` leaves duplicates unchanged, `update` replaces only entered fields and derived values, detection failures become row failures, successful rows get API-derived values, progress counts remain consistent, and staged previews are deleted after terminal completion.

- [ ] **Step 5: Implement asynchronous import worker**

`POST /api/imports/execute` creates a queued `ImportJob` and responds immediately. A single in-process worker claims queued jobs atomically, processes rows in bounded batches with Douyin concurrency 5, updates progress, and marks interrupted `running` jobs back to `queued` during startup recovery.

- [ ] **Step 6: Implement templates, failure files, and exports**

Generate template files with the seven accepted input columns. Export selected IDs when present; otherwise apply current filters to all matching records. Stream `.xlsx` or `.csv`, include decrypted OP secret only during stream generation, and audit every export.

- [ ] **Step 7: Run import/export tests**

Run: `pnpm --filter @douyin-admin/api test -- import-parser.test.ts import-worker.test.ts export.routes.test.ts`

Expected: all tests pass without writing plaintext secrets to MongoDB or test logs.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services apps/api/src/routes apps/api/src/tests
git commit -m "feat(api): add secure account import and export"
```

---

### Task 8: API Wiring, Settings, Logs, and Lifecycle

**Files:**
- Create: `apps/api/src/routes/audit-logs.ts`
- Create: `apps/api/src/routes/settings.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/server.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/tests/api.integration.test.ts`
- Test: `apps/api/src/tests/lifecycle.test.ts`

**Interfaces:**
- Consumes: all API routes and `startImportWorker`.
- Produces: runnable API with `/api/health/live` and `/api/health/ready`.

- [ ] **Step 1: Write integration tests**

Test authentication, create through mocked Douyin API, list, reveal, update, recheck failure preservation, audit-log pagination, settings validation, and health readiness with Mongo connected and disconnected.

- [ ] **Step 2: Implement settings and audit-log routes**

Settings support default page size and session hours within fixed bounds; credentials and encryption keys are never returned or mutated. Audit logs support pagination, action filtering, and date filtering.

- [ ] **Step 3: Compose the application**

Mount middleware in this order: proxy/IP configuration, request ID, security headers, body limits, sessions, auth routes, protected management routes, not-found handler, error handler.

- [ ] **Step 4: Implement lifecycle**

Connect Mongo before listening, verify indexes, recover import jobs, start the worker, handle `SIGTERM`/`SIGINT`, stop accepting requests, stop the worker, close Mongo, and exit nonzero on startup configuration failure.

- [ ] **Step 5: Run complete API validation**

Run: `pnpm --filter @douyin-admin/api test && pnpm --filter @douyin-admin/api typecheck`

Expected: all API tests and type checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): complete service lifecycle and admin APIs"
```

---

### Task 9: Frontend Foundation, Login, and Accepted Admin Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/app/AdminShell.tsx`
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/api.ts`
- Create: `apps/web/src/components/ui/*`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Test: `apps/web/src/tests/login.test.tsx`
- Test: `apps/web/src/tests/admin-shell.test.tsx`

**Interfaces:**
- Consumes: auth API error shape and approved visual design.
- Produces: protected routes, API client, responsive sidebar shell, and reusable controls.

- [ ] **Step 1: Extract the approved design system**

Record exact tokens before JSX:

```css
:root {
  --color-bg: #f5f7fb;
  --color-surface: #ffffff;
  --color-sidebar: #152033;
  --color-primary: #2563eb;
  --color-brand: #ff3b6b;
  --color-text: #172033;
  --color-muted: #7b8495;
  --color-border: #e5e9f0;
  --radius-control: 9px;
  --radius-panel: 11px;
  --sidebar-width: 168px;
}
```

Use code-native Chinese labels and controls. Use one consistent SVG icon family with 1.75px strokes.

- [ ] **Step 2: Write failing login and protected-route tests**

Assert unauthenticated navigation redirects to login, successful login opens `/accounts`, incorrect credentials show the API message, and expired sessions return to login with the original URL retained.

- [ ] **Step 3: Implement API client and authentication**

Use `credentials: "include"` for every request, parse the shared error envelope, and centralize 401 handling. Do not store sessions in localStorage.

- [ ] **Step 4: Build the accepted shell**

Implement sidebar links `抖音账号`, `导入记录`, `操作日志`, and `系统设置`; include logout. At narrow width collapse labels but keep accessible names and a horizontal table viewport.

- [ ] **Step 5: Verify components**

Run: `pnpm --filter @douyin-admin/web test -- login.test.tsx admin-shell.test.tsx && pnpm --filter @douyin-admin/web typecheck`

Expected: tests and type checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add secure login and compact admin shell"
```

---

### Task 10: Account Dashboard and Editor

**Files:**
- Create: `apps/web/src/features/accounts/api.ts`
- Create: `apps/web/src/features/accounts/AccountsPage.tsx`
- Create: `apps/web/src/features/accounts/AccountStats.tsx`
- Create: `apps/web/src/features/accounts/AccountFilters.tsx`
- Create: `apps/web/src/features/accounts/AccountsTable.tsx`
- Create: `apps/web/src/features/accounts/AccountDrawer.tsx`
- Create: `apps/web/src/features/accounts/BatchToolbar.tsx`
- Create: `apps/web/src/features/accounts/status.tsx`
- Test: `apps/web/src/tests/accounts-page.test.tsx`
- Test: `apps/web/src/tests/account-drawer.test.tsx`

**Interfaces:**
- Consumes: account CRUD, stats, reveal, and recheck endpoints.
- Produces: complete interactive account-management workflow.

- [ ] **Step 1: Write failing account-list tests**

Test column order, URL-persisted filters, 300ms search debounce, status labels, pagination, empty-data versus no-results messages, selection behavior, and export precedence for selected rows.

- [ ] **Step 2: Build stats, filters, and table**

Render columns in this exact order:

```text
选择框, 抖音号, sec_uid, 注册时间, OP名称, OP卡密,
OP到期时间, 归属人, 售卖状态, 账号状态, 备注, 操作
```

Mask secrets by default. Truncate `sec_uid`, expose copy through a labeled button, and format all timestamps in `Asia/Shanghai`.

- [ ] **Step 3: Write failing drawer tests**

Assert Douyin ID requires “检测” before save, detection displays derived read-only fields, OP secret recalculates derived expiry, optional OP name accepts empty text, duplicate errors attach to the correct field, and closing returns focus to the opener.

- [ ] **Step 4: Implement create/edit drawer**

Use React Hook Form plus shared Zod rules. Do not send derived fields in the save payload. Keep the current query state after a mutation and invalidate stats plus list queries.

- [ ] **Step 5: Implement sensitive and destructive actions**

Reveal secrets only after explicit click and remask on row change, blur, navigation, or 30-second timeout. Confirm single and batch deletion with affected counts. Batch account status action is “重新检测”, never a manual status selector.

- [ ] **Step 6: Run account UI tests**

Run: `pnpm --filter @douyin-admin/web test -- accounts-page.test.tsx account-drawer.test.tsx`

Expected: all list, form, keyboard, and sensitive-data tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/accounts apps/web/src/tests
git commit -m "feat(web): add full account management dashboard"
```

---

### Task 11: Import, Logs, and Settings UI

**Files:**
- Create: `apps/web/src/features/imports/ImportsPage.tsx`
- Create: `apps/web/src/features/imports/ImportDialog.tsx`
- Create: `apps/web/src/features/imports/api.ts`
- Create: `apps/web/src/features/logs/AuditLogsPage.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Test: `apps/web/src/tests/import-flow.test.tsx`
- Test: `apps/web/src/tests/admin-pages.test.tsx`

**Interfaces:**
- Consumes: template, preview, job, error-file, audit-log, and settings APIs.
- Produces: complete secondary admin workflows.

- [ ] **Step 1: Write failing import workflow tests**

Test template download, file rejection, preview counts, masked OP data, `skip` versus `update`, job polling, progress display, terminal counts, and error-file download.

- [ ] **Step 2: Implement the import dialog**

Use distinct upload, preview, duplicate-strategy, progress, and result states. Disable accidental dismissal while execution is running, but keep keyboard focus trapped and expose an accessible progress label.

- [ ] **Step 3: Build import history**

Show file name, strategy, status, total/new/updated/skipped/failed counts, start/end times, and error download only when failures exist.

- [ ] **Step 4: Build audit logs and settings**

Audit logs are paginated and filterable. Settings expose only non-secret settings with bounded numeric inputs; do not render environment secrets or credential-reset controls.

- [ ] **Step 5: Run secondary-page tests**

Run: `pnpm --filter @douyin-admin/web test -- import-flow.test.tsx admin-pages.test.tsx`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features apps/web/src/tests
git commit -m "feat(web): add import logs and settings workflows"
```

---

### Task 12: Docker, Nginx, and Deployment Configuration

**Files:**
- Create: `.env.example`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`
- Create: `docker-compose.yml`
- Create: `README.md`
- Test: `scripts/smoke-docker.sh`

**Interfaces:**
- Produces: `docker compose up -d --build` deployment on one exposed web port.

- [ ] **Step 1: Create a safe environment template**

Include:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-long-random-password
SESSION_SECRET=replace-with-at-least-32-random-characters
FIELD_ENCRYPTION_KEY=replace-with-base64-encoded-32-byte-key
MONGO_ROOT_USERNAME=douyin_admin
MONGO_ROOT_PASSWORD=replace-with-a-long-random-password
MONGO_DATABASE=douyin_accounts
DOUYIN_CHECK_API_URL=https://unid.tztright.top/check
WEB_PORT=8080
TZ=Asia/Shanghai
```

- [ ] **Step 2: Build production images**

Use non-root runtime users, pinned major base images, multi-stage builds, production-only dependencies, health checks, and read-only application filesystems with writable `/tmp` only where required.

- [ ] **Step 3: Configure Nginx**

Serve Vite assets with immutable cache headers, keep `index.html` uncached, route SPA paths to `index.html`, proxy `/api` to `api:3000`, pass request IDs and forwarding headers, and set upload limit to 10 MB.

- [ ] **Step 4: Configure Compose isolation and persistence**

Expose only `${WEB_PORT}:80` from `web`. Use `expose` for API and Mongo internal ports, a private network, `mongo_data` named volume, Mongo authentication, dependency health conditions, restart policies, and secret values from `.env`.

- [ ] **Step 5: Write and run smoke validation**

`scripts/smoke-docker.sh` must verify:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
curl --fail --silent "http://localhost:${WEB_PORT:-8080}/"
curl --fail --silent "http://localhost:${WEB_PORT:-8080}/api/health/ready"
docker compose ps
```

Expected: web, API, and Mongo report healthy; no API or Mongo host port appears in `docker compose ps`.

- [ ] **Step 6: Verify persistence**

Create a test account through the API, run `docker compose restart`, verify the record remains, then remove only the test record through the API. Do not use `docker compose down -v`.

- [ ] **Step 7: Commit**

```bash
git add .env.example apps/api/Dockerfile apps/web/Dockerfile apps/web/nginx.conf docker-compose.yml README.md scripts/smoke-docker.sh
git commit -m "feat: add isolated docker deployment"
```

---

### Task 13: Browser E2E, Responsive Fidelity, and Final Verification

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/accounts.spec.ts`
- Create: `e2e/import.spec.ts`
- Create: `e2e/responsive.spec.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete Docker deployment.
- Produces: release evidence for core workflows, visual fidelity, responsiveness, and persistence.

- [ ] **Step 1: Add deterministic E2E seed helpers**

Seed only test-database records, mock the external Douyin API at the API dependency boundary for deterministic E2E, and reset only the named E2E database between tests.

- [ ] **Step 2: Write core browser tests**

Cover login/logout, unauthenticated redirect, create with detection, edit, search, both status filters, reveal/remask, single recheck, batch sale update, batch status recheck, delete, import preview/execution, export, logs, and session expiry.

- [ ] **Step 3: Add responsive and accessibility assertions**

Run at 1440×900, 1280×800, 768×1024, and 390×844. Assert no toolbar overlap at 1280px, the sidebar collapses, table columns retain order in a horizontal scroller, dialogs trap focus, Escape closes allowed dialogs, and status text remains visible without relying on color.

- [ ] **Step 4: Run all automated checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
```

Expected: every command exits 0.

- [ ] **Step 5: Perform accepted-design fidelity QA**

Capture the implementation at 1280×800 and compare against the accepted compact-sidebar concept. Inspect at least: exact visible copy, sidebar width and collapse behavior, table column order/density, white versus tinted surfaces, typography hierarchy, status colors plus text, control spacing, masked secrets, horizontal scrolling, and empty/error states. Fix every material mismatch.

- [ ] **Step 6: Verify the real external API separately**

Against a non-test deployment, check the three user-provided IDs and confirm normal, banned, and violation mappings plus `sec_uid` extraction. Record only masked IDs and masked `sec_uid` values in verification notes.

- [ ] **Step 7: Rebuild and smoke-test the final source state**

Run: `docker compose build && docker compose up -d`

Verify login, create, restart persistence, import/export, and health checks from the final images. Confirm `.env` and generated files are untracked.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts e2e package.json README.md
git commit -m "test: verify complete admin workflow"
```
