import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import type { AccountRecord } from "../models/account";
import { createAccountsService } from "../services/accounts";

const context = { ip: "127.0.0.1", userAgent: "test", requestId: "request-id" };

function accountDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: "507f1f77bcf86cd799439011",
    douyinId: "94946893573",
    secUid: "MS4wLjABAAAA-fixture",
    registeredAt: new Date("2026-07-27T00:00:00.000Z"),
    opName: "",
    opSecret: {
      version: 1 as const,
      iv: "aXY=",
      ciphertext: "Y2lwaGVy",
      authTag: "dGFn"
    },
    opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
    owner: "小王",
    saleStatus: "recovered" as const,
    accountStatus: "normal" as const,
    accountCheckedAt: new Date("2026-07-27T00:00:00.000Z"),
    remark: "",
    searchText: "",
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    save: vi.fn(async function (this: unknown) {
      return this;
    }),
    ...overrides
  };
}

function dependencies(
  model: Record<string, unknown>,
  accountStatus: "normal" | "violation" | "banned" = "normal"
) {
  return {
    model: model as unknown as Model<AccountRecord>,
    checkDouyinId: vi.fn(async () => ({
      secUid: `MS4wLjABAAAA-${accountStatus}`,
      accountStatus,
      checkedAt: new Date("2026-07-27T01:00:00.000Z")
    })),
    cipher: {
      encrypt: vi.fn(() => ({
        version: 1 as const,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      })),
      decrypt: vi.fn()
    },
    audit: { write: vi.fn(async () => undefined) }
  };
}

describe("accounts service", () => {
  it("derives identity, status, expiry and encrypted secret on create", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) => ({
      _id: "507f1f77bcf86cd799439011",
      ...value,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      updatedAt: new Date("2026-07-27T00:00:00.000Z")
    }));
    const checkDouyinId = vi.fn(async () => ({
      secUid: "MS4wLjABAAAA-fixture",
      accountStatus: "normal" as const,
      checkedAt: new Date("2026-07-27T00:00:00.000Z")
    }));
    const encrypt = vi.fn(() => ({
      version: 1 as const,
      iv: "aXY=",
      ciphertext: "Y2lwaGVy",
      authTag: "dGFn"
    }));
    const auditWrite = vi.fn(async () => undefined);
    const service = createAccountsService({
      model: { create } as unknown as Model<AccountRecord>,
      checkDouyinId,
      cipher: { encrypt, decrypt: vi.fn() },
      audit: { write: auditWrite }
    });

    const result = await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    }, context);

    expect(checkDouyinId).toHaveBeenCalledWith("94946893573");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      secUid: "MS4wLjABAAAA-fixture",
      accountStatus: "normal",
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      opSecret: expect.objectContaining({ ciphertext: "Y2lwaGVy" })
    }));
    expect(result).not.toHaveProperty("opSecret");
    expect(auditWrite).toHaveBeenCalledOnce();
  });

  it("rejects client supplied derived fields", async () => {
    const service = createAccountsService({
      model: {} as Model<AccountRecord>,
      checkDouyinId: vi.fn(),
      cipher: { encrypt: vi.fn(), decrypt: vi.fn() },
      audit: { write: vi.fn() }
    });

    await expect(service.create({
      douyinId: "94946893573",
      secUid: "client-value",
      accountStatus: "normal",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    }, context)).rejects.toThrow();
  });

  it("defaults a normal account to recovered", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const service = createAccountsService(dependencies({ create }));

    const result = await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      remark: ""
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: "normal",
      saleStatus: "recovered"
    }));
    expect(result.saleStatus).toBe("recovered");
  });

  it("forces a newly detected banned account to disabled", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const service = createAccountsService(dependencies({ create }, "banned"));

    const result = await service.create({
      douyinId: "93180119509",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "recovered",
      remark: ""
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: "banned",
      saleStatus: "disabled"
    }));
    expect(result.saleStatus).toBe("disabled");
  });

  it("forces disabled when changing the Douyin ID to a banned account", async () => {
    const account = accountDocument();
    const findById = vi.fn(async () => account);
    const service = createAccountsService(
      dependencies({ findById }, "banned")
    );

    const result = await service.update(
      String(account._id),
      { douyinId: "93180119509", saleStatus: "recovered" },
      context
    );

    expect(account.save).toHaveBeenCalledOnce();
    expect(result.accountStatus).toBe("banned");
    expect(result.saleStatus).toBe("disabled");
  });

  it("forces disabled when recheck detects a banned account", async () => {
    const account = accountDocument({ saleStatus: "sold" });
    const findById = vi.fn(async () => account);
    const service = createAccountsService(
      dependencies({ findById }, "banned")
    );

    const result = await service.recheck(String(account._id), context);

    expect(account.save).toHaveBeenCalledOnce();
    expect(result.accountStatus).toBe("banned");
    expect(result.saleStatus).toBe("disabled");
  });

  it("rejects manually unlocking a banned account", async () => {
    const account = accountDocument({
      accountStatus: "banned",
      saleStatus: "disabled"
    });
    const findById = vi.fn(async () => account);
    const service = createAccountsService(dependencies({ findById }));

    await expect(
      service.update(String(account._id), { saleStatus: "sold" }, context)
    ).rejects.toMatchObject({
      status: 409,
      code: "BANNED_ACCOUNT_SALE_STATUS_LOCKED"
    });
    expect(account.save).not.toHaveBeenCalled();
  });

  it("rejects a batch sale update that would unlock banned accounts", async () => {
    const countDocuments = vi.fn(async () => 2);
    const updateMany = vi.fn();
    const service = createAccountsService(dependencies({ countDocuments, updateMany }));

    await expect(
      service.batchUpdate(
        ["507f1f77bcf86cd799439011"],
        { saleStatus: "sold" },
        context
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "BANNED_ACCOUNT_SALE_STATUS_LOCKED"
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("allows owner-only batch updates for banned accounts", async () => {
    const countDocuments = vi.fn();
    const updateMany = vi.fn(async () => ({ modifiedCount: 1 }));
    const service = createAccountsService(dependencies({ countDocuments, updateMany }));

    await expect(
      service.batchUpdate(
        ["507f1f77bcf86cd799439011"],
        { owner: " 张三 " },
        context
      )
    ).resolves.toEqual({ updated: 1 });
    expect(countDocuments).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["507f1f77bcf86cd799439011"] } },
      { $set: { owner: "张三" } }
    );
  });

  it("returns unique non-empty owners in Chinese locale order", async () => {
    const distinct = vi.fn(async () => ["张三", "", "小王", "张三", " 李四 "]);
    const service = createAccountsService(dependencies({ distinct }));

    await expect(service.owners()).resolves.toEqual({
      items: ["李四", "小王", "张三"]
    });
    expect(distinct).toHaveBeenCalledWith("owner", { owner: { $ne: "" } });
  });

  it("adds an exact owner to list filters", async () => {
    const lean = vi.fn(async () => []);
    const limit = vi.fn(() => ({ lean }));
    const skip = vi.fn(() => ({ limit }));
    const sort = vi.fn(() => ({ skip }));
    const find = vi.fn(() => ({ sort }));
    const countDocuments = vi.fn(async () => 0);
    const aggregate = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate })
    );

    await service.list({ owner: "张三" });

    expect(find).toHaveBeenCalledWith({ owner: "张三" });
    expect(countDocuments).toHaveBeenCalledWith({ owner: "张三" });
  });
});
