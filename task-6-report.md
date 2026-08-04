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
- `pnpm --filter @douyin-admin/api typecheck`: the new public API code type-checks. The command remains blocked by two pre-existing unrelated fixtures that omit the now-required `opProject` field:
  - `src/tests/import-worker.test.ts:12`
  - `src/tests/op-profile-policy.test.ts:8`
- The Supertest route suite could not run in this sandbox because its temporary localhost listener is denied with `listen EPERM: operation not permitted 0.0.0.0`. Re-run it in an environment that permits local listeners.
