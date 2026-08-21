import { describe, expect, it } from "vitest";
import {
  AccountPatchSchema,
  AccountInputSchema,
  AccountListQuerySchema,
  ACCOUNT_STATUS_LABELS,
  SALE_STATUS_LABELS
} from "./account";

describe("AccountInputSchema", () => {
  it("defaults Google accounts and normalizes email account addresses", () => {
    const base = {
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold" as const,
      remark: ""
    };

    expect(AccountInputSchema.parse(base)).toMatchObject({
      accountKind: "google",
      email: ""
    });
    expect(AccountInputSchema.parse({
      ...base,
      accountKind: "email",
      email: " mail@example.com "
    }).email).toBe("mail@example.com");
  });

  it("requires an email address for email accounts", () => {
    const base = {
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold" as const,
      remark: ""
    };

    expect(() => AccountInputSchema.parse({
      ...base,
      accountKind: "email",
      email: ""
    })).toThrow("邮箱不能为空");
    expect(() => AccountPatchSchema.parse({ accountKind: "email" })).toThrow();
  });

  it("accepts an optional Douyin account password", () => {
    const base = {
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold" as const,
      remark: ""
    };
    expect(AccountInputSchema.parse({ ...base, accountPassword: "douyin-pass" }).accountPassword)
      .toBe("douyin-pass");
    expect(AccountInputSchema.parse(base)).not.toHaveProperty("accountPassword");
  });

  it("rejects an account password longer than 4096 characters", () => {
    expect(() => AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opSecret: "a|b|1782303418",
      owner: "小王",
      accountPassword: "x".repeat(4097)
    })).toThrow();
  });

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
    expect(value.opProject).toBe("douyin");
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

  it("rejects a derived short OP code supplied by a client", () => {
    expect(() =>
      AccountInputSchema.parse({
        douyinId: "94946893573",
        registeredAt: "2026-07-27",
        opName: "",
        opSecret: "a|b|1782303418",
        owner: "小王",
        saleStatus: "unsold",
        remark: "",
        shortOpCode: "123456789"
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
    expect(value.registeredRegion).toBe("中国.香港");
    expect(SALE_STATUS_LABELS.unknown).toBe("未知");
  });

  it("defaults blank registeredRegion to 中国.香港", () => {
    const value = AccountInputSchema.parse({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      registeredRegion: "  ",
      saleStatus: "unknown",
      remark: ""
    });

    expect(value.registeredRegion).toBe("中国.香港");
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
  it("defaults account lists to Google accounts", () => {
    expect(AccountListQuerySchema.parse({}).accountKind).toBe("google");
  });

  it("accepts an exact owner list filter", () => {
    expect(AccountListQuerySchema.parse({ owner: " 张三 " }).owner).toBe("张三");
  });

  it("defaults sortDirection to ascending time order", () => {
    expect(AccountListQuerySchema.parse({}).sortDirection).toBe("asc");
  });

  it("accepts an explicit descending time order", () => {
    expect(AccountListQuerySchema.parse({ sortDirection: "desc" }).sortDirection).toBe("desc");
  });
});

describe("AccountStatus", () => {
  it("exposes labels for unknown and OP invalid", () => {
    expect(ACCOUNT_STATUS_LABELS.unknown).toBe("未知");
    expect(ACCOUNT_STATUS_LABELS.op_invalid).toBe("OP失效");
  });

  it("accepts unknown and op_invalid as list filters", () => {
    expect(
      AccountListQuerySchema.parse({ accountStatus: "unknown" }).accountStatus
    ).toBe("unknown");
    expect(
      AccountListQuerySchema.parse({ accountStatus: "op_invalid" }).accountStatus
    ).toBe("op_invalid");
  });
});

describe("AccountListQuery pageSize", () => {
  it("defaults pageSize to 20", () => {
    expect(AccountListQuerySchema.parse({}).pageSize).toBe(20);
  });

  it("accepts page sizes 20/50/100/all", () => {
    expect(AccountListQuerySchema.parse({ pageSize: 20 }).pageSize).toBe(20);
    expect(AccountListQuerySchema.parse({ pageSize: "50" }).pageSize).toBe(50);
    expect(AccountListQuerySchema.parse({ pageSize: 100 }).pageSize).toBe(100);
    expect(AccountListQuerySchema.parse({ pageSize: "all" }).pageSize).toBe("all");
  });

  it("rejects unsupported page sizes", () => {
    expect(() => AccountListQuerySchema.parse({ pageSize: 30 })).toThrow();
    expect(() => AccountListQuerySchema.parse({ pageSize: "200" })).toThrow();
  });
});
