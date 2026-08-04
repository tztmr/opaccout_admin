import { describe, expect, it } from "vitest";
import { AccountModel } from "../models/account";
import { ImportPreviewModel } from "../models/import-preview";

describe("Account model", () => {
  it("defines unique identity indexes", () => {
    const indexes = AccountModel.schema.indexes();
    const douyinIndex = indexes.find(([keys]) => keys.douyinId === 1);
    const secUidIndex = indexes.find(([keys]) => keys.secUid === 1);

    expect(douyinIndex?.[1].unique).toBe(true);
    expect(secUidIndex?.[1].unique).toBe(true);
    expect(secUidIndex?.[1].partialFilterExpression).toEqual({
      secUid: { $gt: "" }
    });

    expect(AccountModel.schema.path("shortOpCode")).toBeDefined();
    expect(AccountModel.schema.path("opProject")).toBeDefined();
    expect(indexes).toContainEqual([
      { shortOpCode: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { shortOpCode: { $type: "string" } }
      })
    ]);
  });

  it("accepts unknown and rejects values outside the shared status enums", async () => {
    const account = new AccountModel({
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
      saleStatus: "unknown",
      accountStatus: "normal",
      accountCheckedAt: new Date(),
      remark: ""
    });

    await expect(account.validate()).resolves.toBeUndefined();
    account.saleStatus = "invalid" as never;
    await expect(account.validate()).rejects.toThrow();
  });


  it("accepts unknown and op_invalid account statuses with empty sec_uid", async () => {
    for (const accountStatus of ["unknown", "op_invalid"] as const) {
      const account = new AccountModel({
        douyinId: accountStatus === "unknown" ? "111" : "222",
        secUid: "",
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
        saleStatus: "unknown",
        accountStatus,
        accountCheckedAt: new Date(),
        remark: ""
      });
      await expect(account.validate()).resolves.toBeUndefined();
    }
  });

  it("builds normalized search text before validation", async () => {
    const account = new AccountModel({
      douyinId: "94946893573",
      secUid: "MS4wLjABAAAA-Fixture",
      registeredAt: new Date("2026-07-27T00:00:00.000Z"),
      opName: " 星河 ",
      opSecret: {
        version: 1,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      },
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      owner: "小王",
      saleStatus: "unsold",
      accountStatus: "normal",
      accountCheckedAt: new Date(),
      remark: " 新号 "
    });

    await account.validate();

    expect(account.searchText).toContain("ms4wljabaaaa-fixture");
    expect(account.searchText).toContain("星河");
  });
});

describe("ImportPreview model", () => {
  it("defines a TTL index on expiresAt", () => {
    const ttlIndex = ImportPreviewModel.schema
      .indexes()
      .find(([keys]) => keys.expiresAt === 1);

    expect(ttlIndex?.[1].expireAfterSeconds).toBe(0);
  });
});
