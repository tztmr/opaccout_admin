import * as XLSX from "xlsx";
import type { SecretCipher } from "./encryption";
import type { AccountRecord } from "../models/account";
import { ACCOUNT_STATUS_LABELS, SALE_STATUS_LABELS } from "@douyin-admin/shared";

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
  format: "xlsx" | "csv"
): Buffer {
  const rows = accounts.map((account) => ({
    抖音号: account.douyinId,
    sec_uid: account.secUid,
    注册时间: account.registeredAt.toISOString().slice(0, 10),
    OP名称: account.opName,
    OP卡密: cipher.decrypt(account.opSecret),
    OP到期时间: account.opExpiresAt.toISOString(),
    归属人: account.owner,
    注册地区: account.registeredRegion,
    售卖状态: SALE_STATUS_LABELS[account.saleStatus],
    账号状态: ACCOUNT_STATUS_LABELS[account.accountStatus],
    备注: account.remark
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  markColumnAsText(sheet, 2, rows.length);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "抖音账号");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportTemplate(format: "xlsx" | "csv"): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[
    "抖音号", "注册时间", "OP名称", "OP卡密", "归属人", "注册地区", "售卖状态", "备注"
  ]]);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "导入模板");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
