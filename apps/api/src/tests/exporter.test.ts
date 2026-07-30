import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { exportAccounts } from "../services/exporter";

describe("exportAccounts", () => {
  it("exports unknown sale status with its Chinese label", () => {
    const output = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-28T00:00:00.000Z"),
      opName: "",
      opSecret: {
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(() => ({
        version: 1 as const,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      })),
      decrypt: vi.fn(() => "a|b|1782303418")
    }, "csv").toString("utf8");

    expect(output).toContain("未知");
  });

  it("exports 注册地区 after 归属人", () => {
    const buffer = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-28T00:00:00.000Z"),
      opName: "",
      opSecret: {
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.澳门",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(),
      decrypt: vi.fn(() => "a|b|1782303418")
    }, "xlsx");

    const workbook = XLSX.read(buffer, { type: "buffer", cellNF: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      sheet!,
      { defval: "" }
    );

    expect(Object.keys(rows[0] ?? {})).toEqual([
      "抖音号",
      "sec_uid",
      "注册时间",
      "OP名称",
      "OP卡密",
      "OP到期时间",
      "归属人",
      "注册地区",
      "售卖状态",
      "账号状态",
      "备注"
    ]);
    expect(rows[0]?.["注册地区"]).toBe("中国.澳门");
  });

  it("marks 注册时间 cells as text in xlsx exports", () => {
    const buffer = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: {
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(),
      decrypt: vi.fn(() => "a|b|1782303418")
    }, "xlsx");

    const workbook = XLSX.read(buffer, { type: "buffer", cellNF: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];

    expect(sheet?.C2?.t).toBe("s");
    expect(sheet?.C2?.v).toBe("2026-07-11");
    expect(sheet?.C2?.z).toBe("@");
  });
});
