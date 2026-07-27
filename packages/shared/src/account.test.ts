import { describe, expect, it } from "vitest";
import {
  AccountInputSchema,
  AccountListQuerySchema,
  SALE_STATUS_LABELS
} from "./account";

describe("AccountInputSchema", () => {
  it("accepts only administrator-entered fields", () => {
    const value = AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    });

    expect(value.douyinId).toBe("94946893573");
  });

  it("rejects an unknown sale status", () => {
    expect(() =>
      AccountInputSchema.parse({
        douyinId: "94946893573",
        registeredAt: "2026-07-27",
        opName: "",
        opSecret: "a|b|1782303418",
        owner: "小王",
        saleStatus: "normal",
        remark: ""
      })
    ).toThrow();
  });

  it("rejects derived values supplied by a client", () => {
    expect(() =>
      AccountInputSchema.parse({
        douyinId: "94946893573",
        registeredAt: "2026-07-27",
        opName: "",
        opSecret: "a|b|1782303418",
        owner: "小王",
        saleStatus: "unsold",
        remark: "",
        secUid: "client-value"
      })
    ).toThrow();
  });

  it("defaults an omitted sale status to unknown", () => {
    const value = AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      remark: ""
    });

    expect(value.saleStatus).toBe("unknown");
    expect(SALE_STATUS_LABELS.unknown).toBe("未知");
  });

  it("accepts unknown as an explicit input and list filter", () => {
    expect(AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unknown",
      remark: ""
    }).saleStatus).toBe("unknown");

    expect(
      AccountListQuerySchema.parse({ saleStatus: "unknown" }).saleStatus
    ).toBe("unknown");
  });
});

describe("AccountListQuerySchema", () => {
  it("accepts an exact owner list filter", () => {
    expect(AccountListQuerySchema.parse({ owner: " 张三 " }).owner).toBe("张三");
  });
});
