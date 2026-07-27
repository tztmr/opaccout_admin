import { AccountInputSchema, type AccountInput, type SaleStatus } from "@douyin-admin/shared";
import * as XLSX from "xlsx";
import { calculateOpExpiry } from "./op-expiry";

const MAX_ROWS = 10_000;
const STATUS_MAP: Record<string, SaleStatus> = {
  未知: "unknown",
  未售卖: "unsold",
  已售卖: "sold",
  已停用: "disabled",
  已找回: "recovered"
};

export type ParsedRowError = {
  row: number;
  field: string;
  code: string;
  message: string;
};

export type ImportParseResult = {
  rows: AccountInput[];
  errors: ParsedRowError[];
  totalRows: number;
};

function normalizedDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim().replaceAll("/", "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function parseImport(buffer: Buffer, fileName: string): ImportParseResult {
  const extension = fileName.toLocaleLowerCase().split(".").pop();
  if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
    throw new Error("IMPORT_FILE_TYPE_UNSUPPORTED");
  }
  const workbook = extension === "csv"
    ? XLSX.read(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
        type: "string",
        cellDates: true
      })
    : XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!firstSheet) throw new Error("IMPORT_SHEET_MISSING");
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
    raw: extension === "csv"
  });
  if (sourceRows.length > MAX_ROWS) throw new Error("IMPORT_ROW_LIMIT_EXCEEDED");

  const rows: AccountInput[] = [];
  const errors: ParsedRowError[] = [];
  const seen = new Set<string>();

  sourceRows.forEach((source, index) => {
    const rowNumber = index + 2;
    const douyinId = String(source["抖音号"] ?? "").trim();
    const saleStatusLabel = String(source["售卖状态"] ?? "").trim();
    const candidate = {
      douyinId,
      registeredAt: normalizedDate(source["注册时间"]),
      opName: String(source["OP名称"] ?? "").trim(),
      opSecret: String(source["OP卡密"] ?? "").trim(),
      owner: String(source["归属人"] ?? "").trim(),
      saleStatus: saleStatusLabel
        ? STATUS_MAP[saleStatusLabel] ?? saleStatusLabel
        : undefined,
      remark: String(source["备注"] ?? "").trim()
    };
    const parsed = AccountInputSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNumber,
          field: issue.path.join(".") || "_form",
          code: "VALIDATION_FAILED",
          message: issue.message
        });
      }
    } else {
      try {
        calculateOpExpiry(parsed.data.opSecret);
      } catch {
        errors.push({
          row: rowNumber,
          field: "opSecret",
          code: "OP_SECRET_TIMESTAMP_INVALID",
          message: "OP卡密最后一段必须是10位时间戳"
        });
      }
      rows.push(parsed.data);
    }
    if (seen.has(douyinId)) {
      errors.push({
        row: rowNumber,
        field: "douyinId",
        code: "DOUYIN_ID_DUPLICATE_IN_FILE",
        message: "文件内抖音号重复"
      });
    }
    if (douyinId) seen.add(douyinId);
  });

  return { rows, errors, totalRows: sourceRows.length };
}
