# Task 6 report: public short OP resolve API

## Delivered

- Added anonymous `POST /api/op/resolve` before all administrator-protected routes.
- The strict request schema accepts only a 9-digit short OP code.
- Missing, expired, `op_invalid`, unknown-project, decryption, and wake-URL construction failures all return the same `404` response.
- Successful responses include `opData`, `project`, `expiresAt`, and `wakeUrl` and all public API responses use `Cache-Control: no-store`.
- Added a per-client-IP 30 request / 60 second limiter; request 31 returns `429` with `no-store`.
- Server constructs the public service with the production cipher and injects it into the app. No secret, decrypted OP, or wake URL is logged.

## Verification

- `git diff --check`: passed.
- `pnpm --filter @douyin-admin/api exec vitest run src/tests/public-op.routes.test.ts`: passed (7 tests), including malformed JSON returning a generic `400` response with `Cache-Control: no-store`.
- `pnpm --filter @douyin-admin/api typecheck`: the new public API code type-checks. The command remains blocked by two pre-existing unrelated fixtures that omit the now-required `opProject` field:
  - `src/tests/import-worker.test.ts:12`
  - `src/tests/op-profile-policy.test.ts:8`
- The focused Supertest route suite was run with a permitted local listener.

## Follow-up fix

- JSON syntax errors occur before the route handler. A public-endpoint-scoped parser error handler now converts them to the same generic malformed-code response, preserves `no-store`, and leaves other API error handling unchanged.
