import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseImport } from "../services/import-parser";

function workbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "账号");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseImport", () => {
  it("maps approved Chinese columns and optional OP name", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      售卖状态: "未售卖",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows[0]).toMatchObject({
      douyinId: "94946893573",
      opName: "",
      saleStatus: "unsold"
    });
    expect(result.errors).toEqual([]);
  });

  it("reports duplicate IDs and invalid OP timestamps", () => {
    const row = {
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP名称: "",
      OP卡密: "invalid",
      归属人: "小王",
      售卖状态: "未售卖",
      备注: ""
    };
    const result = parseImport(workbookBuffer([row, row]), "accounts.xlsx");

    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["OP_SECRET_TIMESTAMP_INVALID", "DOUYIN_ID_DUPLICATE_IN_FILE"])
    );
  });
});
