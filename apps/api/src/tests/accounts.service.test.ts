import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import type { AccountRecord } from "../models/account";
import { createAccountsService } from "../services/accounts";

const context = { ip: "127.0.0.1", userAgent: "test", requestId: "request-id" };

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
});
