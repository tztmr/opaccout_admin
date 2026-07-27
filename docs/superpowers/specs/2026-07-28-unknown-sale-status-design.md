# Unknown Sale Status Design

**Date:** 2026-07-28

## Goal

Add “未知” as a complete, manageable sale status and make it the default for
accounts created from now on. Imports that omit the sale status must receive the
same default. Existing account records must remain unchanged.

## Status Model

Add `unknown` to the shared sale-status enum and map it to the Chinese label
“未知”. The complete sale-status set becomes:

- `unknown` — 未知
- `unsold` — 未售卖
- `sold` — 已售卖
- `disabled` — 已停用
- `recovered` — 已找回

`AccountInputSchema` defaults an omitted `saleStatus` to `unknown`. MongoDB
continues to require a non-empty enum value; `null` and missing stored values are
not used to represent “未知”.

## Data and Compatibility Rules

- No migration or bulk update runs against existing accounts.
- Existing “未售卖”, “已售卖”, “已停用”, and “已找回” values remain unchanged.
- New accounts created without an explicit sale status store `unknown`.
- The permanent banned-account invariant remains higher priority: if Douyin
  detection returns `banned`, the server stores `disabled` even when the
  submitted or default status is `unknown`.
- Single and batch updates may explicitly change a non-banned account to or from
  `unknown`.
- A banned account remains locked to `disabled` and cannot be changed to
  `unknown`.

## Import and Export

- Add “未知” to the import status mapping.
- A blank sale-status cell is treated as omitted input so the shared schema
  supplies `unknown`.
- An explicit “未知” cell imports as `unknown`.
- Other valid status labels keep their current behavior.
- Export renders `unknown` as “未知”.
- Duplicate handling remains unchanged: imports may skip or update an existing
  account by Douyin ID.

## Web Interface

- The new-account drawer defaults its sale-status select to “未知”.
- “未知” appears in the new/edit drawer, toolbar filter, and batch sale-status
  choices.
- Account rows display “未知” with a neutral gray tag.
- Existing statistic cards remain unchanged. “未知” contributes to “全部账号”
  only; it does not receive a new statistic card.
- URL filtering and unselected exports support `saleStatus=unknown` through the
  existing shared query contract.

## API and Error Handling

The API accepts `unknown` anywhere a sale status is accepted today. Invalid
status values continue to produce the existing validation error. No new endpoint
or database collection is introduced.

The banned-account lock continues to return HTTP 409 with
`BANNED_ACCOUNT_SALE_STATUS_LOCKED` when a caller attempts to set a banned
account to `unknown` or any other non-disabled sale status.

## Verification

Automated coverage must verify:

- shared account input defaults to `unknown`;
- explicit `unknown` passes shared list and input validation;
- blank and explicit “未知” imports produce `unknown`;
- detected banned accounts still override `unknown` to `disabled`;
- export labels `unknown` as “未知”;
- frontend export filters preserve `saleStatus=unknown`.

Final verification must run workspace lint, type checking, tests, and production
builds; rebuild the existing Docker Compose deployment; then confirm in the
browser that “未知” is the default, appears in all sale-status controls, uses the
neutral tag, and does not change existing records.
