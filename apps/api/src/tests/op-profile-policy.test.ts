import type { AccountInput } from "@douyin-admin/shared";
import { describe, expect, it } from "vitest";
import {
  applyOpProfileResult,
  resolveAccountStatus
} from "../services/op-profile-policy";

const input: AccountInput = {
  douyinId: "94946893573",
  registeredAt: "2026-07-28",
  opName: "导入名称",
  opSecret: "openid|token|pay|pfkey|1782303418",
  owner: "小王",
  saleStatus: "unknown",
  remark: "原备注"
};

describe("applyOpProfileResult", () => {
  it("replaces the OP name with the API nickname on success", () => {
    expect(
      applyOpProfileResult(input, {
        kind: "success",
        nickname: " API昵称 "
      })
    ).toMatchObject({
      opName: "API昵称",
      saleStatus: "unknown",
      remark: "原备注"
    });
  });

  it("accepts an empty API nickname without falling back", () => {
    expect(
      applyOpProfileResult(input, {
        kind: "success",
        nickname: ""
      })
    ).toMatchObject({
      opName: "",
      saleStatus: "unknown",
      remark: "原备注"
    });
  });

  it("forces disabled only for invalid-openid", () => {
    expect(applyOpProfileResult(input, { kind: "invalid-openid" }))
      .toMatchObject({
        opName: "导入名称",
        saleStatus: "disabled",
        remark: "原备注"
      });
  });

  it("appends another ret message without replacing submitted fields", () => {
    expect(
      applyOpProfileResult(input, {
        kind: "message",
        message: "token is invalid"
      })
    ).toMatchObject({
      opName: "导入名称",
      saleStatus: "unknown",
      remark: "原备注 | OP: token is invalid"
    });
  });

  it("uses the empty-remark format for unavailable responses", () => {
    expect(
      applyOpProfileResult(
        { ...input, remark: "" },
        { kind: "unavailable" }
      ).remark
    ).toBe("OP: 查询失败");
  });

  it("keeps both the original and OP note within 1000 characters", () => {
    const result = applyOpProfileResult(
      { ...input, remark: "原".repeat(1000) },
      { kind: "message", message: "错".repeat(1000) }
    );

    expect(result.remark).toHaveLength(1000);
    expect(result.remark).toMatch(/^原+ \| OP: 错+$/);
  });
});

describe("resolveAccountStatus", () => {
  it("marks OP token invalid as op_invalid", () => {
    expect(
      resolveAccountStatus("normal", {
        kind: "message",
        message: "token is invalid"
      })
    ).toBe("op_invalid");
  });

  it("keeps detected Douyin status for other OP outcomes", () => {
    expect(resolveAccountStatus("banned", { kind: "invalid-openid" })).toBe(
      "banned"
    );
    expect(
      resolveAccountStatus("violation", {
        kind: "message",
        message: "something else"
      })
    ).toBe("violation");
    expect(
      resolveAccountStatus("unknown", {
        kind: "success",
        nickname: "昵称"
      })
    ).toBe("unknown");
  });
});
