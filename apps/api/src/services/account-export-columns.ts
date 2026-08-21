import {
  ACCOUNT_COLUMN_LABELS,
  ACCOUNT_STATUS_LABELS,
  DEFAULT_OP_PROJECT,
  OP_PROJECTS,
  SALE_STATUS_LABELS,
  normalizeAccountColumnOrder,
  type AccountColumnId,
  type AccountKind
} from "@douyin-admin/shared";
import type { AccountRecord } from "../models/account";
import type { SecretCipher } from "./encryption";

type ExportAccount = AccountRecord & { _id: unknown };

export type AccountExportColumn = {
  id: AccountColumnId;
  header: string;
  text: boolean;
  value(account: ExportAccount): string;
};

const TEXT_COLUMN_IDS = new Set<AccountColumnId>([
  "douyin", "email", "password", "secuid", "date", "shortop", "mobile"
]);

export function buildAccountExportColumns(
  accountKind: AccountKind,
  order: unknown,
  cipher: SecretCipher
): AccountExportColumn[] {
  const values: Record<AccountColumnId, (account: ExportAccount) => string> = {
    douyin: (account) => account.douyinId,
    email: (account) => account.email ?? "",
    password: (account) => account.accountPassword
      ? cipher.decrypt(account.accountPassword)
      : "",
    secuid: (account) => account.secUid,
    date: (account) => account.registeredAt.toISOString().slice(0, 10),
    opname: (account) => account.opName,
    opsecret: (account) => cipher.decrypt(account.opSecret),
    shortop: (account) => account.shortOpCode ?? "",
    mobile: (account) => account.mobile ?? "",
    project: (account) => OP_PROJECTS[account.opProject ?? DEFAULT_OP_PROJECT].name,
    expiry: (account) => account.opExpiresAt.toISOString(),
    owner: (account) => account.owner,
    region: (account) => account.registeredRegion,
    sale: (account) => SALE_STATUS_LABELS[account.saleStatus],
    status: (account) => ACCOUNT_STATUS_LABELS[account.accountStatus],
    remark: (account) => account.remark
  };

  return normalizeAccountColumnOrder(accountKind, order).map((id) => ({
    id,
    header: ACCOUNT_COLUMN_LABELS[id],
    text: TEXT_COLUMN_IDS.has(id),
    value: values[id]
  }));
}
