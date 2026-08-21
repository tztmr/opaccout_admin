import * as XLSX from "xlsx";
import type { AccountColumnId } from "@douyin-admin/shared";
import { describe, expect, it, vi } from "vitest";
import { exportAccounts, exportTemplate } from "../services/exporter";

describe("exportAccounts", () => {
  it("exports a decrypted password immediately after 抖音号", () => {
    const encryptedPassword = {
      version: 1 as const,
      iv: "cGFzc3dvcmQtaXY=",
      ciphertext: "ZW5jcnlwdGVkLXBhc3N3b3Jk",
      authTag: "cGFzc3dvcmQtdGFn"
    };
    const buffer = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      accountPassword: encryptedPassword,
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-28T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
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
      decrypt: vi.fn((value) => value === encryptedPassword ? "douyin-pass" : "a|b|1782303418")
    }, "xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet!, { defval: "" });

    expect(Object.keys(rows[0] ?? {}).slice(0, 3)).toEqual([
      "抖音号", "密码", "sec_uid"
    ]);
    expect(rows[0]?.["密码"]).toBe("douyin-pass");
  });

  it("exports an empty password for records without one", () => {
    const output = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-28T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
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
    }], { encrypt: vi.fn(), decrypt: vi.fn(() => "a|b|1782303418") }, "xlsx");
    const workbook = XLSX.read(output, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet!, { defval: "" });

    expect(rows[0]?.["密码"]).toBe("");
  });

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
      "密码",
      "sec_uid",
      "注册时间",
      "OP名称",
      "OP卡密",
      "短 OP",
      "手机号",
      "项目",
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

    expect(sheet?.D2?.t).toBe("s");
    expect(sheet?.D2?.v).toBe("2026-07-11");
    expect(sheet?.D2?.z).toBe("@");
  });

  it("exports mobile between short OP and project by default", () => {
    const output = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      shortOpCode: "123456789",
      opProject: "douyin",
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
    }], { encrypt: vi.fn(), decrypt: vi.fn(() => "a|b|1782303418") }, "csv").toString("utf8");

    expect(output).toContain("OP卡密,短 OP,手机号,项目,OP到期时间");
    expect(output).toContain(",123456789,,抖音,");
  });

  it("marks account identifiers and short OP as text in xlsx exports", () => {
    const buffer = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      shortOpCode: "123456789",
      opProject: "douyin",
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
    }], { encrypt: vi.fn(), decrypt: vi.fn(() => "a|b|1782303418") }, "xlsx");
    const sheet = XLSX.read(buffer, { type: "buffer", cellNF: true }).Sheets["抖音谷歌账号"];

    expect(sheet?.A2).toMatchObject({ t: "s", z: "@" });
    expect(sheet?.B2).toMatchObject({ t: "s", z: "@" });
    expect(sheet?.C2).toMatchObject({ t: "s", z: "@" });
    expect(sheet?.D2).toMatchObject({ t: "s", z: "@" });
    expect(sheet?.G2).toMatchObject({ t: "s", v: "123456789", z: "@" });
  });

  it("includes 项目 in import templates without a short OP column", () => {
    const csv = exportTemplate("csv").toString("utf8");

    expect(csv).toContain("抖音号,密码,注册时间");
    expect(csv).toContain("OP卡密,手机号,项目,归属人");
    expect(csv).not.toContain("短 OP");
  });

  it("uses exact Google and email export columns", () => {
    const account = {
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      email: "mail@example.com",
      accountPassword: { version: 1 as const, iv: "aXY=", ciphertext: "cGFzcw==", authTag: "dGFn" },
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "op-name",
      opSecret: { version: 1 as const, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      shortOpCode: "123456789",
      opProject: "douyin" as const,
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown" as const,
      accountStatus: "normal" as const,
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    };
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn(() => "123456789") };

    const googleCsv = exportAccounts([account], cipher, "csv").toString("utf8");
    const emailCsv = exportAccounts([account], cipher, "csv", "email").toString("utf8");

    expect(googleCsv.split("\n")[0]).toBe(
      "抖音号,密码,sec_uid,注册时间,OP名称,OP卡密,短 OP,手机号,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态,备注"
    );
    expect(emailCsv.split("\n")[0]).toBe(
      "抖音号,邮箱,密码,sec_uid,注册时间,OP名称,OP卡密,短 OP,手机号,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态,备注"
    );
  });

  it("keeps kind-specific empty sheets and text cells stable", () => {
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn(() => "123456789") };
    const emptyGoogle = XLSX.read(exportAccounts([], cipher, "xlsx"), { type: "buffer" });
    const emptyEmail = XLSX.read(exportAccounts([], cipher, "xlsx", "email"), { type: "buffer" });
    const emailAccount = {
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      email: "mail@example.com",
      accountPassword: { version: 1 as const, iv: "aXY=", ciphertext: "cGFzcw==", authTag: "dGFn" },
      secUid: "123456789",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1 as const, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      shortOpCode: "123456789",
      opProject: "douyin" as const,
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown" as const,
      accountStatus: "normal" as const,
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    };
    const emailWorkbook = XLSX.read(
      exportAccounts([emailAccount], cipher, "xlsx", "email"),
      { type: "buffer", cellNF: true }
    );
    const emailSheet = emailWorkbook.Sheets["抖音邮箱号"];

    expect(emptyGoogle.SheetNames).toEqual(["抖音谷歌账号"]);
    expect(emptyGoogle.Sheets["抖音谷歌账号"]?.A1?.v).toBe("抖音号");
    expect(emptyEmail.SheetNames).toEqual(["抖音邮箱号"]);
    expect(emptyEmail.Sheets["抖音邮箱号"]?.B1?.v).toBe("邮箱");
    expect(emailSheet?.A2).toMatchObject({ t: "s", z: "@" });
    expect(emailSheet?.B2).toMatchObject({ t: "s", z: "@" });
    expect(emailSheet?.C2).toMatchObject({ t: "s", z: "@" });
    expect(emailSheet?.D2).toMatchObject({ t: "s", z: "@" });
    expect(emailSheet?.E2).toMatchObject({ t: "s", z: "@" });
    expect(emailSheet?.H2).toMatchObject({ t: "s", z: "@" });
  });

  it("adds the email column only to email templates", () => {
    expect(exportTemplate("csv").toString("utf8")).toContain("抖音号,密码,注册时间");
    expect(exportTemplate("csv", "email").toString("utf8")).toContain(
      "抖音号,邮箱,密码,注册时间"
    );
  });

  it("exports Google headers and values in its normalized saved order", () => {
    const encryptedPassword = { version: 1 as const, iv: "cGFzcy1pdg==", ciphertext: "cGFzcw==", authTag: "cGFzcy10YWc=" };
    const encryptedOpSecret = { version: 1 as const, iv: "b3AtaXY=", ciphertext: "b3A=", authTag: "b3AtdGFn" };
    const order: AccountColumnId[] = [
      "remark", "mobile", "shortop", "douyin", "password", "secuid",
      "date", "opname", "opsecret", "project", "expiry", "owner",
      "region", "sale", "status"
    ];
    const csv = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      email: "must-not-export@example.com",
      mobile: "+86 13037174892",
      accountPassword: encryptedPassword,
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "op-name",
      opSecret: encryptedOpSecret,
      shortOpCode: "123456789",
      opProject: "douyin",
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "自定义备注",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(),
      decrypt: vi.fn((value) => value === encryptedPassword ? "douyin-pass" : "op|secret|1782303418")
    }, "csv", "google", order).toString("utf8").trimEnd().split("\n");

    expect(csv[0]).toBe(
      "备注,手机号,短 OP,抖音号,密码,sec_uid,注册时间,OP名称,OP卡密,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态"
    );
    expect(csv[1]).toBe(
      "自定义备注,+86 13037174892,123456789,94946893573,douyin-pass,MS4wLjABAAAA-fixture,2026-07-11,op-name,op|secret|1782303418,抖音,2026-08-23T12:16:58.000Z,小王,中国.香港,未知,正常"
    );
    expect(csv.join("\n")).not.toContain("must-not-export@example.com");
  });

  it("marks mobile as text at its dynamic XLSX position without changing its value", () => {
    const order: AccountColumnId[] = [
      "remark", "mobile", "douyin", "password", "secuid", "date",
      "opname", "opsecret", "shortop", "project", "expiry", "owner",
      "region", "sale", "status"
    ];
    const workbook = XLSX.read(exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      mobile: "+86 13037174892",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "备注",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(),
      decrypt: vi.fn(() => "op|secret|1782303418")
    }, "xlsx", "google", order), { type: "buffer", cellNF: true });

    expect(workbook.Sheets["抖音谷歌账号"]?.B2).toMatchObject({
      t: "s",
      z: "@",
      v: "+86 13037174892"
    });
  });

  it("places email only where the Email saved order specifies", () => {
    const order: AccountColumnId[] = [
      "remark", "mobile", "email", "douyin", "password", "secuid",
      "date", "opname", "opsecret", "shortop", "project", "expiry",
      "owner", "region", "sale", "status"
    ];
    const csv = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
      douyinId: "94946893573",
      email: "mail@example.com",
      mobile: "+852 65478974",
      secUid: "MS4wLjABAAAA-fixture",
      registeredAt: new Date("2026-07-11T00:00:00.000Z"),
      opName: "",
      opSecret: { version: 1, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      registeredRegion: "中国.香港",
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "邮箱号",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(),
      decrypt: vi.fn(() => "op|secret|1782303418")
    }, "csv", "email", order).toString("utf8").trimEnd().split("\n");

    expect(csv[0]?.split(",").slice(0, 5)).toEqual([
      "备注", "手机号", "邮箱", "抖音号", "密码"
    ]);
    expect(csv[1]?.split(",").slice(0, 5)).toEqual([
      "邮箱号", "+852 65478974", "mail@example.com", "94946893573", ""
    ]);
  });

  it("orders templates by saved importable columns and restores omitted required columns", () => {
    const customOrder: AccountColumnId[] = ["remark", "mobile", "email", "douyin"];
    const googleHeader = exportTemplate("csv", "google", customOrder)
      .toString("utf8").trim();
    const emailHeader = exportTemplate("csv", "email", customOrder)
      .toString("utf8").trim();

    expect(googleHeader).toBe(
      "备注,手机号,抖音号,密码,注册时间,OP名称,OP卡密,项目,归属人,注册地区,售卖状态"
    );
    expect(googleHeader).not.toContain("邮箱");
    expect(emailHeader).toBe(
      "备注,手机号,邮箱,抖音号,密码,注册时间,OP名称,OP卡密,项目,归属人,注册地区,售卖状态"
    );
  });
});
