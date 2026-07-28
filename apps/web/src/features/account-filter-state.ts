import type { SaleStatus } from "@douyin-admin/shared";

export const DEFAULT_ACCOUNT_SALE_STATUS: SaleStatus = "unknown";

const FILTER_KEYS = [
  "keyword",
  "sortDirection",
  "saleStatus",
  "accountStatus",
  "owner",
  "registeredFrom",
  "registeredTo"
] as const;

export function buildAccountExportParams(
  url: URLSearchParams,
  selected: Set<string>
): URLSearchParams {
  const result = new URLSearchParams({ format: "xlsx" });
  if (selected.size > 0) {
    result.set("ids", [...selected].join(","));
    return result;
  }
  for (const key of FILTER_KEYS) {
    const value = url.get(key);
    if (value) result.set(key, value);
  }
  return result;
}
