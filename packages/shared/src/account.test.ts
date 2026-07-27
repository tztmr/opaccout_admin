import { describe, expect, it } from "vitest";
import { AccountInputSchema, AccountListQuerySchema } from "./account";

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

  it("defaults new accounts to recovered", () => {
    const value = AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      remark: ""
    });

    expect(value.saleStatus).toBe("recovered");
  });
});

describe("AccountListQuerySchema", () => {
  it("accepts an exact owner list filter", () => {
    expect(AccountListQuerySchema.parse({ owner: " 张三 " }).owner).toBe("张三");
  });
});
