import * as XLSX from "xlsx";
import {
  ACCOUNT_COLUMN_LABELS,
  ACCOUNT_IMPORT_COLUMN_IDS,
  normalizeAccountColumnOrder,
  type AccountKind
} from "@douyin-admin/shared";
import type { SecretCipher } from "./encryption";
import type { AccountRecord } from "../models/account";
import { buildAccountExportColumns } from "./account-export-columns";

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
  accountKind: AccountKind = "google",
  columnOrder?: unknown
): Buffer {
  const columns = buildAccountExportColumns(accountKind, columnOrder, cipher);
  const headers = columns.map((column) => column.header);
  const rows = accounts.map((account) => columns.map((column) => column.value(account)));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  columns.forEach((column, columnIndex) => {
    if (column.text) markColumnAsText(sheet, columnIndex, rows.length);
  });
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
  accountKind: AccountKind = "google",
  columnOrder?: unknown
): Buffer {
  const importableIds = new Set(ACCOUNT_IMPORT_COLUMN_IDS);
  const headers = normalizeAccountColumnOrder(accountKind, columnOrder)
    .filter((id) => importableIds.has(id))
    .map((id) => ACCOUNT_COLUMN_LABELS[id]);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  if (format === "csv") return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "导入模板");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
