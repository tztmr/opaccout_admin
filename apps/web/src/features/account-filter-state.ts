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
): {
  format: "xlsx";
  ids?: string[];
  keyword?: string;
  sortDirection?: string;
  saleStatus?: string;
  accountStatus?: string;
  owner?: string;
  registeredFrom?: string;
  registeredTo?: string;
} {
  const result: {
    format: "xlsx";
    ids?: string[];
    keyword?: string;
    sortDirection?: string;
    saleStatus?: string;
    accountStatus?: string;
    owner?: string;
    registeredFrom?: string;
    registeredTo?: string;
  } = { format: "xlsx" };
  if (selected.size > 0) {
    result.ids = [...selected];
    return result;
  }
  for (const key of FILTER_KEYS) {
    const value = url.get(key);
    if (value) result[key] = value;
  }
  return result;
}
