import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS } from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import { AuditLogModel } from "../models/audit-log";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";

describe("AuditLog model", () => {
  it("stores the non-sensitive account kind for export audit records", () => {
    expect(AuditLogModel.schema.path("accountKind")?.options.enum).toEqual(ACCOUNT_KINDS);
  });
});

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
    expect(indexes).toContainEqual([
      { accountKind: 1, registeredAt: 1, _id: 1 },
      expect.objectContaining({ background: true })
    ]);
    expect(AccountModel.schema.path("accountKind")?.options.enum).toEqual(ACCOUNT_KINDS);
    expect(AccountModel.schema.path("email")).toBeDefined();
    expect(AccountModel.schema.path("email")?.options.default).toBe("");
    expect(AccountModel.schema.path("mobile")?.options).toMatchObject({
      required: false,
      trim: true,
      maxlength: 32,
      default: ""
    });
  });

  it("accepts unknown and rejects values outside the shared status enums", async () => {
    const account = new AccountModel({
      douyinId: "94946893573",
      accountKind: "email",
      email: "mail@example.com",
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
    const encryptedPassword = {
      version: 1 as const,
      iv: "cGFzc3dvcmQtaXY=",
      ciphertext: "cGFzc3dvcmQtY2lwaGVydGV4dA==",
      authTag: "cGFzc3dvcmQtdGFn"
    };
    const account = new AccountModel({
      douyinId: "94946893573",
      accountKind: "email",
      email: "mail@example.com",
      mobile: " +86 13037174892 ",
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
      remark: " 新号 ",
      shortOpCode: "123456789",
      opProject: "douyin",
      accountPassword: encryptedPassword
    });

    await account.validate();

    expect(account.searchText).toContain("ms4wljabaaaa-fixture");
    expect(account.searchText).toContain("星河");
    expect(account.searchText).toContain("123456789");
    expect(account.searchText).toContain("抖音");
    expect(account.searchText).toContain("mail@example.com");
    expect(account.get("mobile")).toBe("+86 13037174892");
    expect(account.searchText).toContain("+86 13037174892");
    expect(account.toObject().accountPassword).toEqual(encryptedPassword);
    expect(account.searchText).not.toContain("douyin-pass");
  });
});

describe("ImportPreview model", () => {
  it("defines a TTL index on expiresAt", () => {
    const ttlIndex = ImportPreviewModel.schema
      .indexes()
      .find(([keys]) => keys.expiresAt === 1);

    expect(ttlIndex?.[1].expireAfterSeconds).toBe(0);
  });

  it("defaults historical preview records to the Google account kind", async () => {
    const preview = new ImportPreviewModel({
      fileName: "accounts.csv",
      fileType: "csv",
      ownerSessionId: "session-id",
      stagedRows: [],
      rowErrors: [],
      totalRows: 0,
      validRows: 0,
      expiresAt: new Date("2026-08-21T00:00:00.000Z")
    });

    await expect(preview.validate()).resolves.toBeUndefined();
    expect(preview.accountKind).toBe("google");
  });
});

describe("ImportJob model", () => {
  it("defaults historical jobs to the Google account kind", async () => {
    const job = new ImportJobModel({
      previewId: "preview-id",
      fileName: "accounts.csv",
      duplicateStrategy: "skip",
      status: "queued",
      total: 0
    });

    await expect(job.validate()).resolves.toBeUndefined();
    expect(job.accountKind).toBe("google");
  });
});
