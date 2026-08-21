import type { AccountKind } from "./account";

export const ACCOUNT_COLUMN_IDS = [
  "douyin", "email", "password", "secuid", "date", "opname",
  "opsecret", "shortop", "mobile", "project", "expiry", "owner",
  "region", "sale", "status", "remark"
] as const;

export type AccountColumnId = (typeof ACCOUNT_COLUMN_IDS)[number];

export const DEFAULT_ACCOUNT_COLUMN_ORDER: Record<AccountKind, AccountColumnId[]> = {
  google: [
    "douyin", "password", "secuid", "date", "opname", "opsecret",
    "shortop", "mobile", "project", "expiry", "owner", "region",
    "sale", "status", "remark"
  ],
  email: [
    "douyin", "email", "password", "secuid", "date", "opname",
    "opsecret", "shortop", "mobile", "project", "expiry", "owner",
    "region", "sale", "status", "remark"
  ]
};

export const ACCOUNT_COLUMN_LABELS: Record<AccountColumnId, string> = {
  douyin: "抖音号",
  email: "邮箱",
  password: "密码",
  secuid: "sec_uid",
  date: "注册时间",
  opname: "OP名称",
  opsecret: "OP卡密",
  shortop: "短 OP",
  mobile: "手机号",
  project: "项目",
  expiry: "OP到期时间",
  owner: "归属人",
  region: "注册地区",
  sale: "售卖状态",
  status: "账号状态",
  remark: "备注"
};

export const ACCOUNT_IMPORT_COLUMN_IDS: AccountColumnId[] = [
  "douyin", "email", "password", "date", "opname", "opsecret",
  "mobile", "project", "owner", "region", "sale", "remark"
];

export function normalizeAccountColumnOrder(
  accountKind: AccountKind,
  value: unknown
): AccountColumnId[] {
  const defaultOrder = DEFAULT_ACCOUNT_COLUMN_ORDER[accountKind];
  if (!Array.isArray(value)) return [...defaultOrder];

  const allowed = new Set(defaultOrder);
  const selected = new Set<AccountColumnId>();
  const prefix: AccountColumnId[] = [];

  for (const column of value) {
    if (
      typeof column === "string" &&
      allowed.has(column as AccountColumnId) &&
      !selected.has(column as AccountColumnId)
    ) {
      const id = column as AccountColumnId;
      selected.add(id);
      prefix.push(id);
    }
  }

  return [...prefix, ...defaultOrder.filter((id) => !selected.has(id))];
}
