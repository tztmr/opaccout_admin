import { describe, expect, it } from "vitest";
import {
  ACCOUNT_COLUMN_IDS,
  ACCOUNT_COLUMN_LABELS,
  ACCOUNT_IMPORT_COLUMN_IDS,
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  normalizeAccountColumnOrder
} from "./account-columns";

describe("account column contracts", () => {
  it("defines the Google default business column order", () => {
    expect(DEFAULT_ACCOUNT_COLUMN_ORDER.google).toEqual([
      "douyin", "password", "secuid", "date", "opname", "opsecret",
      "shortop", "mobile", "project", "expiry", "owner", "region",
      "sale", "status", "remark"
    ]);
  });

  it("defines the Email default business column order", () => {
    expect(DEFAULT_ACCOUNT_COLUMN_ORDER.email).toEqual([
      "douyin", "email", "password", "secuid", "date", "opname",
      "opsecret", "shortop", "mobile", "project", "expiry", "owner",
      "region", "sale", "status", "remark"
    ]);
  });

  it("keeps a valid unique prefix and restores omitted Google columns", () => {
    expect(normalizeAccountColumnOrder("google", ["remark", "douyin", "remark", "email", "unknown"]))
      .toEqual([
        "remark", "douyin", "password", "secuid", "date", "opname",
        "opsecret", "shortop", "mobile", "project", "expiry", "owner",
        "region", "sale", "status"
      ]);
  });

  it("keeps email only for Email accounts", () => {
    expect(normalizeAccountColumnOrder("email", ["email"])).toContain("email");
    expect(normalizeAccountColumnOrder("google", ["email"])).not.toContain("email");
  });

  it("falls back to a clone of the kind default for non-array values", () => {
    const order = normalizeAccountColumnOrder("google", null);
    expect(order).toEqual(DEFAULT_ACCOUNT_COLUMN_ORDER.google);
    expect(order).not.toBe(DEFAULT_ACCOUNT_COLUMN_ORDER.google);
  });

  it("defines the stable import business column order", () => {
    expect(ACCOUNT_IMPORT_COLUMN_IDS).toEqual([
      "douyin", "email", "password", "date", "opname", "opsecret",
      "mobile", "project", "owner", "region", "sale", "remark"
    ]);
    expect(ACCOUNT_IMPORT_COLUMN_IDS.every((column) => ACCOUNT_COLUMN_IDS.includes(column))).toBe(true);
  });

  it("maps every stable business column to its Chinese label", () => {
    expect(ACCOUNT_COLUMN_LABELS).toEqual({
      douyin: "抖音号",
      email: "邮箱",
      password: "密码",
      secuid: "sec_uid",
      date: "注册时间",
      opname: "OP名称",
      opsecret: "OP卡密",
      shortop: "短 OP",
      mobile: "手机号",
      project: "项目",
      expiry: "OP到期时间",
      owner: "归属人",
      region: "注册地区",
      sale: "售卖状态",
      status: "账号状态",
      remark: "备注"
    });
  });
});
