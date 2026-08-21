import {
  AccountInputSchema,
  DEFAULT_OP_PROJECT,
  DEFAULT_REGISTERED_REGION,
  type AccountKind,
  type AccountInput,
  type SaleStatus
} from "@douyin-admin/shared";
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
const PROJECT_MAP: Record<string, typeof DEFAULT_OP_PROJECT> = {
  "": DEFAULT_OP_PROJECT,
  抖音: DEFAULT_OP_PROJECT,
  douyin: DEFAULT_OP_PROJECT
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

function pickValue(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }
  return "";
}

export function normalizedDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return shanghaiDate(value);
  }

  const text = String(value ?? "").trim();
  if (!text) return "";

  const isoDay = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (isoDay?.[1] && isoDay[2] && isoDay[3]) {
    return formatDateParts(isoDay[1], isoDay[2], isoDay[3]);
  }

  const slashYearFirst = text.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
  );
  if (slashYearFirst?.[1] && slashYearFirst[2] && slashYearFirst[3]) {
    return formatDateParts(
      slashYearFirst[1],
      slashYearFirst[2],
      slashYearFirst[3]
    );
  }

  const slashDayFirst = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
  );
  if (slashDayFirst?.[1] && slashDayFirst[2] && slashDayFirst[3]) {
    return formatDateParts(
      slashDayFirst[3],
      slashDayFirst[2],
      slashDayFirst[1]
    );
  }

  const chinese = text.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?$/
  );
  if (chinese?.[1] && chinese[2] && chinese[3]) {
    return formatDateParts(chinese[1], chinese[2], chinese[3]);
  }

  return "";
}

function formatDateParts(
  yearText: string,
  monthText: string,
  dayText: string
): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }

  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const probe = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return "";
  }
  return candidate;
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

export function parseImport(
  buffer: Buffer,
  fileName: string,
  accountKind: AccountKind = "google"
): ImportParseResult {
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
    // Prefer raw Excel Date cells so locale display strings like "6/16/26"
    // do not depend on spreadsheet formatting.
    raw: true
  });
  if (sourceRows.length > MAX_ROWS) throw new Error("IMPORT_ROW_LIMIT_EXCEEDED");

  const rows: AccountInput[] = [];
  const errors: ParsedRowError[] = [];
  const seen = new Set<string>();

  sourceRows.forEach((source, index) => {
    const rowNumber = index + 2;
    const douyinId = String(source["抖音号"] ?? "").trim();
    if (douyinId && seen.has(douyinId)) {
      return;
    }
    const saleStatusLabel = String(source["售卖状态"] ?? "").trim();
    const projectLabel = String(source["项目"] ?? "").trim();
    const candidate = {
      accountKind,
      email: accountKind === "email"
        ? String(pickValue(source, "邮箱", "email", "Email")).trim()
        : "",
      mobile: String(pickValue(source, "手机号", "mobile", "Mobile")).trim(),
      douyinId,
      accountPassword: String(source["密码"] ?? "").trim(),
      registeredAt: normalizedDate(pickValue(source, "注册时间", "时间")),
      opName: String(pickValue(source, "OP名称", "op名称")).trim(),
      opSecret: String(pickValue(source, "OP卡密", "op卡密")).trim(),
      owner: String(source["归属人"] ?? "").trim(),
      registeredRegion: String(source["注册地区"] ?? "").trim() || DEFAULT_REGISTERED_REGION,
      saleStatus: saleStatusLabel
        ? STATUS_MAP[saleStatusLabel] ?? saleStatusLabel
        : undefined,
      remark: String(source["备注"] ?? "").trim(),
      opProject: PROJECT_MAP[projectLabel] ?? projectLabel
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
    if (douyinId) seen.add(douyinId);
  });

  return { rows, errors, totalRows: sourceRows.length };
}
