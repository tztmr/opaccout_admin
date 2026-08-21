import * as XLSX from "xlsx";
import type { AccountKind } from "@douyin-admin/shared";
import type { SecretCipher } from "./encryption";
import type { AccountRecord } from "../models/account";
import {
  ACCOUNT_STATUS_LABELS,
  DEFAULT_OP_PROJECT,
  OP_PROJECTS,
  SALE_STATUS_LABELS
} from "@douyin-admin/shared";

function markColumnAsText(sheet: XLSX.WorkSheet, columnIndex: number, rowCount: number) {
  for (let rowIndex = 2; rowIndex <= rowCount + 1; rowIndex += 1) {
    const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex - 1 });
    const cell = sheet[address];
    if (!cell) continue;
    cell.t = "s";
    cell.z = "@";
  }
}

export function exportAccounts(
  accounts: Array<AccountRecord & { _id: unknown }>,
  cipher: SecretCipher,
  format: "xlsx" | "csv",
  accountKind: AccountKind = "google"
): Buffer {
  const headers = accountKind === "email"
    ? ["抖音号", "邮箱", "密码", "sec_uid", "注册时间", "OP名称", "OP卡密", "短 OP", "项目", "OP到期时间", "归属人", "注册地区", "售卖状态", "账号状态", "备注"]
    : ["抖音号", "密码", "sec_uid", "注册时间", "OP名称", "OP卡密", "短 OP", "项目", "OP到期时间", "归属人", "注册地区", "售卖状态", "账号状态", "备注"];
  const rows = accounts.map((account) => {
    const common = [
      account.douyinId,
      account.accountPassword ? cipher.decrypt(account.accountPassword) : "",
      account.secUid,
      account.registeredAt.toISOString().slice(0, 10),
      account.opName,
      cipher.decrypt(account.opSecret),
      account.shortOpCode ?? "",
      OP_PROJECTS[account.opProject ?? DEFAULT_OP_PROJECT].name,
      account.opExpiresAt.toISOString(),
      account.owner,
      account.registeredRegion,
      SALE_STATUS_LABELS[account.saleStatus],
      ACCOUNT_STATUS_LABELS[account.accountStatus],
      account.remark
    ];
    return accountKind === "email"
      ? [common[0], account.email ?? "", ...common.slice(1)]
      : common;
  });
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  const textColumns = accountKind === "email"
    ? [0, 1, 2, 3, 4, 7]
    : [0, 1, 2, 3, 6];
  for (const columnIndex of textColumns) {
    markColumnAsText(sheet, columnIndex, rows.length);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    accountKind === "email" ? "抖音邮箱号" : "抖音谷歌账号"
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportTemplate(
  format: "xlsx" | "csv",
  accountKind: AccountKind = "google"
): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[
    "抖音号",
    ...(accountKind === "email" ? ["邮箱"] : []),
    "密码", "注册时间", "OP名称", "OP卡密", "项目", "归属人", "注册地区", "售卖状态", "备注"
  ]]);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "导入模板");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
