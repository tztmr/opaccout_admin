import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseImport } from "../services/import-parser";

function workbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "账号");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseImport", () => {
  it("reads a UTF-8 Chinese CSV without a BOM", () => {
    const csv = [
      "抖音号,注册时间,OP名称,OP卡密,归属人,注册地区,售卖状态,备注",
      "94946893573,2026-07-27,星图运营,a|b|1782303418,小王,,未售卖,正常账号"
    ].join("\n");

    const result = parseImport(Buffer.from(csv, "utf8"), "accounts.csv");

    expect(result.rows[0]).toMatchObject({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unsold"
    });
    expect(result.errors).toEqual([]);
  });

  it("maps approved Chinese columns and optional OP name", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      注册地区: "中国.澳门",
      售卖状态: "未售卖",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows[0]).toMatchObject({
      douyinId: "94946893573",
      opName: "",
      registeredRegion: "中国.澳门",
      saleStatus: "unsold"
    });
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["", "douyin"],
    ["抖音", "douyin"],
    ["douyin", "douyin"]
  ])("maps the %s project label to %s", (项目, opProject) => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      项目
    }]), "accounts.xlsx");

    expect(result.rows[0]?.opProject).toBe(opProject);
    expect(result.errors).toEqual([]);
  });

  it("reports an unknown project as an opProject validation error", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      项目: "未知项目"
    }]), "accounts.xlsx");

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ field: "opProject", code: "VALIDATION_FAILED" })
    ]);
  });

  it("does not import a supplied short OP code", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      "短 OP": "123456789"
    }]), "accounts.xlsx");

    expect(result.rows[0]).not.toHaveProperty("shortOpCode");
    expect(result.errors).toEqual([]);
  });

  it("defaults blank 注册地区 cells to 中国.香港", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-28",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      注册地区: "",
      售卖状态: "",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows[0]?.registeredRegion).toBe("中国.香港");
    expect(result.errors).toEqual([]);
  });

  it("defaults blank sale status cells to unknown", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-28",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      售卖状态: "",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows[0]?.saleStatus).toBe("unknown");
    expect(result.errors).toEqual([]);
  });

  it("imports an explicit unknown sale status", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-28",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      售卖状态: "未知",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows[0]?.saleStatus).toBe("unknown");
    expect(result.errors).toEqual([]);
  });

  it("rejects an unrecognized non-blank sale status", () => {
    const result = parseImport(workbookBuffer([{
      抖音号: "94946893573",
      注册时间: "2026-07-28",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      售卖状态: "随便填写",
      备注: ""
    }]), "accounts.xlsx");

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: "saleStatus",
        code: "VALIDATION_FAILED"
      })
    ]);
  });

  it("reports invalid OP timestamps", () => {
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
      expect.arrayContaining(["OP_SECRET_TIMESTAMP_INVALID"])
    );
  });

  it("deduplicates repeated douyin IDs and keeps one row", () => {
    const row = {
      抖音号: "94946893573",
      注册时间: "2026-07-27",
      OP名称: "",
      OP卡密: "a|b|1782303418",
      归属人: "小王",
      售卖状态: "未售卖",
      备注: ""
    };
    const result = parseImport(workbookBuffer([row, row]), "accounts.xlsx");

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      owner: "小王"
    });
  });

  it("normalizes common Chinese and slash datetime registeredAt values", () => {
    const result = parseImport(
      workbookBuffer([
        {
          抖音号: "10000000001",
          注册时间: "13/7/2026 22:29",
          OP名称: "",
          OP卡密: "a|b|1782303418",
          归属人: "小王",
          售卖状态: "未售卖",
          备注: ""
        },
        {
          抖音号: "10000000002",
          注册时间: "2026/7/9 22:26",
          OP名称: "",
          OP卡密: "a|b|1782303418",
          归属人: "小王",
          售卖状态: "未售卖",
          备注: ""
        },
        {
          抖音号: "10000000003",
          注册时间: "2026年6月24日23:15:19",
          OP名称: "",
          OP卡密: "a|b|1782303418",
          归属人: "小王",
          售卖状态: "未售卖",
          备注: ""
        }
      ]),
      "accounts.xlsx"
    );

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.registeredAt)).toEqual([
      "2026-07-13",
      "2026-07-09",
      "2026-06-24"
    ]);
  });

  it("uses Asia/Shanghai calendar date for Excel Date cells", () => {
    const result = parseImport(
      workbookBuffer([
        {
          抖音号: "10000000004",
          注册时间: new Date("2026-06-16T15:29:17.000Z"),
          OP名称: "",
          OP卡密: "a|b|1782303418",
          归属人: "小王",
          售卖状态: "未售卖",
          备注: ""
        }
      ]),
      "accounts.xlsx"
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.registeredAt).toBe("2026-06-16");
  });

  it("accepts 时间 and op名称 header aliases from exported workbooks", () => {
    const result = parseImport(
      workbookBuffer([
        {
          抖音号: "87032695043",
          时间: new Date("2026-07-20T17:54:16.999Z"),
          op名称: "",
          op卡密:
            "2B89B50F61961F25A80FD01267184D52|1A4B810925766705CC41D6ADBF6E5239|4798D098F45B276777E2F30FAE0C6070|8a410b96adf7fa505a7390061e825001|1783103172",
          归属人: "冒险王",
          注册地区: "",
          售卖状态: "",
          备注: ""
        }
      ]),
      "accounts.xlsx"
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      douyinId: "87032695043",
      registeredAt: "2026-07-21",
      opName: "",
      owner: "冒险王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown"
    });
  });
});
