import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import type { AccountRecord } from "../models/account";
import { createAccountsService } from "../services/accounts";
import type { OpProfileCheckResult } from "../services/op-profile";

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt: vi.fn(() => 123456789)
}));

const context = { ip: "127.0.0.1", userAgent: "test", requestId: "request-id" };

const encryptedPassword = {
  version: 1 as const,
  iv: "cGFzc3dvcmQtaXY=",
  ciphertext: "cGFzc3dvcmQtY2lwaGVydGV4dA==",
  authTag: "cGFzc3dvcmQtdGFn"
};

type AccountTestDocument = AccountRecord & {
  _id: string;
  save: ReturnType<typeof vi.fn>;
};

function accountDocument(overrides: Record<string, unknown> = {}): AccountTestDocument {
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
    registeredRegion: "中国.香港",
    saleStatus: "unknown" as const,
    accountStatus: "normal" as const,
    accountCheckedAt: new Date("2026-07-27T00:00:00.000Z"),
    remark: "",
    shortOpCode: "123456789",
    opProject: "douyin" as const,
    searchText: "",
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    save: vi.fn(async function (this: unknown) {
      return this;
    }),
    ...overrides
  } as AccountTestDocument;
}

function dependencies(
  model: Record<string, unknown>,
  accountStatus: "normal" | "violation" | "banned" | "unknown" | "op_invalid" = "normal"
) {
  return {
    model: model as unknown as Model<AccountRecord>,
    checkDouyinId: vi.fn(async () => ({
      secUid: `MS4wLjABAAAA-${accountStatus}`,
      accountStatus,
      checkedAt: new Date("2026-07-27T01:00:00.000Z")
    })),
    checkOpProfile: vi.fn<() => Promise<OpProfileCheckResult>>(async () => ({
      kind: "success",
      nickname: "API昵称"
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
    const checkOpProfile = vi.fn(async () => ({
      kind: "success" as const,
      nickname: "API昵称"
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
      checkOpProfile,
      cipher: { encrypt, decrypt: vi.fn() },
      audit: { write: auditWrite }
    });

    const result = await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      mobile: " +86 13037174892 ",
      owner: "小王",
      registeredRegion: "中国.澳门",
      saleStatus: "unsold",
      remark: ""
    }, context);

    expect(checkDouyinId).toHaveBeenCalledWith("94946893573");
    expect(checkOpProfile).toHaveBeenCalledWith("a|b|1782303418");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      secUid: "MS4wLjABAAAA-fixture",
      registeredRegion: "中国.澳门",
      accountStatus: "normal",
      opExpiresAt: new Date("2026-09-22T12:16:58.000Z"),
      mobile: "+86 13037174892",
      opSecret: expect.objectContaining({ ciphertext: "Y2lwaGVy" })
    }));
    expect(result).not.toHaveProperty("opSecret");
    expect(result.registeredRegion).toBe("中国.澳门");
    expect(result).toMatchObject({
      shortOpCode: "123456789",
      opProject: "douyin",
      mobile: "+86 13037174892"
    });
    expect(auditWrite).toHaveBeenCalledOnce();
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.created",
      accountKind: "google"
    }));
    expect(auditWrite).toHaveBeenCalledWith(expect.not.objectContaining({
      changedFields: expect.arrayContaining(["email"])
    }));
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({
      changedFields: expect.arrayContaining(["mobile"])
    }));
    expect(JSON.stringify(auditWrite.mock.calls)).not.toContain("+86 13037174892");
  });

  it("encrypts a new account password without persisting plaintext", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const encrypt = vi.fn((value: string) => value === "douyin-pass"
      ? encryptedPassword
      : {
          version: 1 as const,
          iv: "aXY=",
          ciphertext: "Y2lwaGVy",
          authTag: "dGFn"
        });
    const auditWrite = vi.fn(async () => undefined);
    const service = createAccountsService({
      model: { create } as unknown as Model<AccountRecord>,
      checkDouyinId: vi.fn(async () => ({
        secUid: "MS4wLjABAAAA-fixture",
        accountStatus: "normal" as const,
        checkedAt: new Date("2026-07-27T00:00:00.000Z")
      })),
      checkOpProfile: vi.fn(async () => ({ kind: "success" as const, nickname: "API昵称" })),
      cipher: {
        encrypt,
        decrypt: vi.fn((value) => value === encryptedPassword ? "douyin-pass" : "")
      },
      audit: { write: auditWrite }
    });

    const result = await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: "",
      accountPassword: "douyin-pass"
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      accountPassword: encryptedPassword
    }));
    expect(result.accountPassword).toBe("douyin-pass");
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("douyin-pass");
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.created",
      changedFields: expect.arrayContaining(["accountPassword"])
    }));
    expect(JSON.stringify(auditWrite.mock.calls)).not.toContain("douyin-pass");
  });

  it("persists an email account kind and address on create", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create });
    const service = createAccountsService(deps);

    const result = await service.create({
      douyinId: "94946893573",
      accountKind: "email",
      email: "mail@example.com",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      accountKind: "email",
      email: "mail@example.com"
    }));
    expect(result).toMatchObject({ accountKind: "email", email: "mail@example.com" });
    expect(deps.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.created",
      accountKind: "email",
      changedFields: expect.arrayContaining(["accountKind", "email"])
    }));
  });

  it("preserves an existing account password when an update omits it", async () => {
    const account = accountDocument({ accountPassword: encryptedPassword });
    const deps = dependencies({ findById: vi.fn(async () => account) });
    deps.cipher.decrypt = vi.fn(() => "douyin-pass");
    const service = createAccountsService(deps);

    await service.update(String(account._id), { remark: "keep" }, context);

    expect(account.accountPassword).toBe(encryptedPassword);
  });

  it("preserves an existing mobile for non-mobile patches and clears it only when explicitly blank", async () => {
    const account = accountDocument({ mobile: "+86 13037174892" });
    const persisted = account as AccountTestDocument & { mobile?: string };
    const deps = dependencies({ findById: vi.fn(async () => account) });
    const service = createAccountsService(deps);

    await service.update(String(account._id), { remark: "keep" }, context);

    expect(persisted.mobile).toBe("+86 13037174892");
    expect(deps.audit.write).toHaveBeenLastCalledWith(expect.objectContaining({
      changedFields: expect.not.arrayContaining(["mobile"])
    }));
    expect(JSON.stringify(deps.audit.write.mock.calls)).not.toContain("+86 13037174892");

    await service.update(String(account._id), { mobile: "   " }, context);

    expect(persisted.mobile).toBe("");
    expect(deps.audit.write).toHaveBeenLastCalledWith(expect.objectContaining({
      changedFields: expect.arrayContaining(["mobile"])
    }));
  });

  it("replaces an existing account password with encrypted content", async () => {
    const account = accountDocument({ accountPassword: encryptedPassword });
    const deps = dependencies({ findById: vi.fn(async () => account) });
    deps.cipher.decrypt = vi.fn(() => "replacement");
    const service = createAccountsService(deps);

    await service.update(String(account._id), { accountPassword: "replacement" }, context);

    expect(deps.cipher.encrypt).toHaveBeenCalledWith("replacement");
    expect(deps.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.updated",
      changedFields: expect.arrayContaining(["accountPassword"])
    }));
    expect(JSON.stringify(deps.audit.write.mock.calls)).not.toContain("replacement");
  });

  it("clears an existing account password when an update supplies an empty string", async () => {
    const account = accountDocument({ accountPassword: encryptedPassword });
    const service = createAccountsService(
      dependencies({ findById: vi.fn(async () => account) })
    );

    await service.update(String(account._id), { accountPassword: "" }, context);

    expect(account.accountPassword).toBeUndefined();
  });

  it("returns an empty account password for a historical record", async () => {
    const account = accountDocument();
    const lean = vi.fn(async () => account);
    const service = createAccountsService(
      dependencies({ findById: vi.fn(() => ({ lean })) })
    );

    const result = await service.get(String(account._id));

    expect(result.accountPassword).toBe("");
  });

  it("returns resolved account kind and email in DTOs", async () => {
    const legacyAccount = accountDocument();
    const emailAccount = accountDocument({
      accountKind: "email",
      email: "mail@example.com"
    });
    const legacyService = createAccountsService(
      dependencies({ findById: vi.fn(() => ({ lean: vi.fn(async () => legacyAccount) })) })
    );
    const emailService = createAccountsService(
      dependencies({ findById: vi.fn(() => ({ lean: vi.fn(async () => emailAccount) })) })
    );

    await expect(legacyService.get(String(legacyAccount._id))).resolves.toMatchObject({
      accountKind: "google",
      email: "",
      mobile: ""
    });
    await expect(emailService.get(String(emailAccount._id))).resolves.toMatchObject({
      accountKind: "email",
      email: "mail@example.com"
    });
  });

  it("rejects clearing an email account address", async () => {
    const account = accountDocument({ accountKind: "email", email: "mail@example.com" });
    const service = createAccountsService(
      dependencies({ findById: vi.fn(async () => account) })
    );

    await expect(service.update(String(account._id), { email: "" }, context))
      .rejects.toMatchObject({ status: 400, code: "EMAIL_REQUIRED" });
    expect(account.email).toBe("mail@example.com");
    expect(account.save).not.toHaveBeenCalled();
  });

  it("rejects account kind changes through PATCH", async () => {
    const findById = vi.fn();
    const service = createAccountsService(dependencies({ findById }));

    await expect(service.update(
      "507f1f77bcf86cd799439011",
      { accountKind: "email" },
      context
    )).rejects.toBeDefined();
    expect(findById).not.toHaveBeenCalled();
  });

  it("updates email accounts but keeps Google and historical account emails empty", async () => {
    const emailAccount = accountDocument({ accountKind: "email", email: "old@example.com" });
    const emailDeps = dependencies({ findById: vi.fn(async () => emailAccount) });
    const emailService = createAccountsService(
      emailDeps
    );

    await emailService.update(String(emailAccount._id), { email: "new@example.com" }, context);
    expect(emailAccount.email).toBe("new@example.com");
    expect(emailDeps.audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.updated",
      accountKind: "email",
      changedFields: expect.arrayContaining(["email"])
    }));

    for (const accountKind of [undefined, "google"] as const) {
      const account = accountDocument({ accountKind, email: "stale@example.com" });
      const deps = dependencies({ findById: vi.fn(async () => account) });
      const service = createAccountsService(
        deps
      );

      await service.update(String(account._id), { email: "other@example.com" }, context);
      expect(account.email).toBe("");
      expect(deps.audit.write).toHaveBeenCalledWith(expect.objectContaining({
        action: "account.updated",
        accountKind: "google",
        changedFields: expect.not.arrayContaining(["email"])
      }));
    }
  });

  it("keeps the assigned short OP code when updating an account", async () => {
    const account = accountDocument();
    const service = createAccountsService(
      dependencies({ findById: vi.fn(async () => account) })
    );

    const result = await service.update(
      String(account._id),
      { remark: "changed" },
      context
    );

    expect(result).toMatchObject({
      shortOpCode: "123456789",
      opProject: "douyin",
      remark: "changed"
    });
    expect(account.save).toHaveBeenCalledOnce();
  });

  it("rejects client supplied derived fields", async () => {
    const service = createAccountsService({
      model: {} as Model<AccountRecord>,
      checkDouyinId: vi.fn(),
      checkOpProfile: vi.fn(),
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

  it("persists the API nickname for a newly created account", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create });
    deps.checkOpProfile.mockResolvedValue({
      kind: "success",
      nickname: "API昵称"
    });
    const service = createAccountsService(deps);

    await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "提交名称",
      opSecret: "openid|token|pay|pfkey|1782303418",
      owner: "小王",
      saleStatus: "unknown",
      remark: ""
    }, context);

    expect(deps.checkOpProfile).toHaveBeenCalledWith(
      "openid|token|pay|pfkey|1782303418"
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      opName: "API昵称",
      saleStatus: "unknown"
    }));
  });

  it("forces disabled when OP returns invalid-openid", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create });
    deps.checkOpProfile.mockResolvedValue({ kind: "invalid-openid" });
    const service = createAccountsService(deps);

    const result = await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "提交名称",
      opSecret: "openid|token|pay|pfkey|1782303418",
      owner: "小王",
      saleStatus: "sold",
      remark: "原备注"
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      opName: "提交名称",
      saleStatus: "disabled",
      remark: "原备注"
    }));
    expect(result.saleStatus).toBe("disabled");
  });

  it("appends another OP ret message before create", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create });
    deps.checkOpProfile.mockResolvedValue({
      kind: "message",
      message: "token is invalid"
    });
    const service = createAccountsService(deps);

    await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "提交名称",
      opSecret: "openid|token|pay|pfkey|1782303418",
      owner: "小王",
      saleStatus: "unknown",
      remark: "原备注"
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      opName: "提交名称",
      saleStatus: "unknown",
      accountStatus: "op_invalid",
      remark: "原备注 | OP: token is invalid"
    }));
  });

  it("stores unknown account status when Douyin check cannot resolve sec_uid", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create });
    const { DouyinCheckError } = await import("../services/douyin-check");
    deps.checkDouyinId.mockRejectedValue(
      new DouyinCheckError("DOUYIN_RESPONSE_INVALID", true)
    );
    const service = createAccountsService(deps);

    await service.create({
      douyinId: "94946893573",
      registeredAt: "2026-07-28",
      opName: "提交名称",
      opSecret: "openid|token|pay|pfkey|1782303418",
      owner: "小王",
      saleStatus: "unknown",
      remark: ""
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      secUid: "",
      accountStatus: "unknown",
      saleStatus: "unknown"
    }));
  });

  it("keeps a banned Douyin account disabled after OP success", async () => {
    const create = vi.fn(async (value: Record<string, unknown>) =>
      accountDocument(value)
    );
    const deps = dependencies({ create }, "banned");
    deps.checkOpProfile.mockResolvedValue({
      kind: "success",
      nickname: "API昵称"
    });
    const service = createAccountsService(deps);

    const result = await service.create({
      douyinId: "93180119509",
      registeredAt: "2026-07-28",
      opName: "提交名称",
      opSecret: "openid|token|pay|pfkey|1782303418",
      owner: "小王",
      saleStatus: "sold",
      remark: ""
    }, context);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      opName: "API昵称",
      accountStatus: "banned",
      saleStatus: "disabled"
    }));
    expect(result.saleStatus).toBe("disabled");
  });

  it("defaults a normal account to unknown", async () => {
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
      saleStatus: "unknown"
    }));
    expect(result.saleStatus).toBe("unknown");
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
      saleStatus: "unknown",
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
      { douyinId: "93180119509", saleStatus: "unknown" },
      context
    );

    expect(account.save).toHaveBeenCalledOnce();
    expect(result.accountStatus).toBe("banned");
    expect(result.saleStatus).toBe("disabled");
  });

  it("does not query OP when editing an existing account", async () => {
    const account = accountDocument();
    const deps = dependencies({
      findById: vi.fn(async () => account)
    });
    const service = createAccountsService(deps);

    await service.update(
      String(account._id),
      { opSecret: "new-openid|new-token|pay|pfkey|1782303418" },
      context
    );

    expect(deps.checkOpProfile).not.toHaveBeenCalled();
    expect(account.save).toHaveBeenCalledOnce();
  });

  it("prefers existing secUid during recheck", async () => {
    const account = accountDocument({
      secUid: "MS4wLjABAAAA-existing-sec"
    });
    const findById = vi.fn(async () => account);
    const deps = dependencies({ findById }, "violation");
    const service = createAccountsService(deps);

    const result = await service.recheck(String(account._id), context);

    expect(deps.checkDouyinId).toHaveBeenCalledWith(account.douyinId, {
      secUid: "MS4wLjABAAAA-existing-sec"
    });
    expect(result.accountStatus).toBe("violation");
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

  it("refreshes the OP nickname and clears op_invalid when the OP token is valid", async () => {
    const account = accountDocument({
      opName: "旧昵称",
      accountStatus: "op_invalid",
      saleStatus: "unknown"
    });
    const deps = dependencies({
      findById: vi.fn(async () => account)
    });
    deps.cipher.decrypt = vi.fn(() => "openid|token|pay|pfkey|1782303418");
    deps.checkOpProfile.mockResolvedValue({
      kind: "success",
      nickname: "API新昵称"
    });
    const service = createAccountsService(deps);

    const originalSecUid = account.secUid;
    const result = await service.recheckOp(String(account._id), context);

    expect(deps.cipher.decrypt).toHaveBeenCalledWith(account.opSecret);
    expect(deps.checkOpProfile).toHaveBeenCalledWith(
      "openid|token|pay|pfkey|1782303418"
    );
    expect(deps.checkDouyinId).toHaveBeenCalledWith(account.douyinId, {
      secUid: originalSecUid
    });
    expect(account.save).toHaveBeenCalledOnce();
    expect(result.opName).toBe("API新昵称");
    expect(result.accountStatus).toBe("normal");
  });

  it("batch rechecks OP and reports individual failures", async () => {
    const first = accountDocument({ _id: "507f1f77bcf86cd799439011" });
    const second = accountDocument({ _id: "507f1f77bcf86cd799439012" });
    const deps = dependencies({
      findById: vi.fn(async (id: string) => {
        if (id === String(first._id)) return first;
        if (id === String(second._id)) return second;
        return null;
      })
    });
    deps.cipher.decrypt = vi.fn((value) =>
      value === first.opSecret
        ? "openid|token-a|pay|pfkey|1782303418"
        : "openid|token-b|pay|pfkey|1782303418"
    );
    deps.checkOpProfile
      .mockResolvedValueOnce({ kind: "success", nickname: "第一条" })
      .mockRejectedValueOnce(new Error("OP_RECHECK_FAILED"));
    const service = createAccountsService(deps);

    const result = await service.batchRecheckOp(
      [String(first._id), String(second._id)],
      context
    );

    expect(result.succeeded).toHaveLength(1);
    expect(result.succeeded[0]?.opName).toBe("第一条");
    expect(result.failed).toEqual([
      { id: String(second._id), code: "OP_RECHECK_FAILED" }
    ]);
  });

  it("skips banned accounts during a batch OP recheck", async () => {
    const banned = accountDocument({
      _id: "507f1f77bcf86cd799439011",
      accountStatus: "banned",
      saleStatus: "disabled"
    });
    const deps = dependencies({
      findById: vi.fn(async () => banned)
    });
    deps.cipher.decrypt = vi.fn(() => "openid|token|pay|pfkey|1782303418");
    const service = createAccountsService(deps);

    const result = await service.batchRecheckOp([String(banned._id)], context);

    expect(result).toEqual({
      succeeded: [],
      failed: [],
      skipped: [{ id: String(banned._id), code: "BANNED_ACCOUNT" }]
    });
    expect(deps.cipher.decrypt).not.toHaveBeenCalled();
    expect(deps.checkOpProfile).not.toHaveBeenCalled();
    expect(banned.save).not.toHaveBeenCalled();
  });

  it("rejects manually unlocking a banned account", async () => {
    const account = accountDocument({
      accountStatus: "banned",
      saleStatus: "disabled"
    });
    const findById = vi.fn(async () => account);
    const service = createAccountsService(dependencies({ findById }));

    await expect(
      service.update(String(account._id), { saleStatus: "unknown" }, context)
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
        { saleStatus: "unknown" },
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

  it("allows batch updates for registeredRegion", async () => {
    const countDocuments = vi.fn();
    const updateMany = vi.fn(async () => ({ modifiedCount: 2 }));
    const service = createAccountsService(dependencies({ countDocuments, updateMany }));

    await expect(
      service.batchUpdate(
        ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
        { registeredRegion: " 中国.台湾 " },
        context
      )
    ).resolves.toEqual({ updated: 2 });

    expect(countDocuments).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"] } },
      { $set: { registeredRegion: "中国.台湾" } }
    );
  });

  it("allows batch updates for accountStatus", async () => {
    const countDocuments = vi.fn();
    const updateMany = vi.fn(async () => ({ modifiedCount: 2 }));
    const service = createAccountsService(dependencies({ countDocuments, updateMany }));

    await expect(
      service.batchUpdate(
        ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
        { accountStatus: "violation" },
        context
      )
    ).resolves.toEqual({ updated: 2 });

    expect(countDocuments).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"] } },
      {
        $set: expect.objectContaining({
          accountStatus: "violation",
          accountCheckedAt: expect.any(Date)
        })
      }
    );
  });

  it("forces saleStatus disabled when batch-setting accountStatus to banned", async () => {
    const countDocuments = vi.fn();
    const updateMany = vi.fn(async () => ({ modifiedCount: 1 }));
    const service = createAccountsService(dependencies({ countDocuments, updateMany }));

    await expect(
      service.batchUpdate(
        ["507f1f77bcf86cd799439011"],
        { accountStatus: "banned" },
        context
      )
    ).resolves.toEqual({ updated: 1 });

    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["507f1f77bcf86cd799439011"] } },
      {
        $set: expect.objectContaining({
          accountStatus: "banned",
          saleStatus: "disabled",
          accountCheckedAt: expect.any(Date)
        })
      }
    );
  });

  it("returns unique non-empty owners in Chinese locale order", async () => {
    const distinct = vi.fn(async () => ["张三", "", "小王", "张三", " 李四 "]);
    const service = createAccountsService(dependencies({ distinct }));

    await expect(service.owners()).resolves.toEqual({
      items: ["李四", "小王", "张三"]
    });
    expect(distinct).toHaveBeenCalledWith("owner", {
      $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }],
      owner: { $ne: "" }
    });
  });

  it("scopes email lists, stats, batch keyword matches, and owners to email accounts", async () => {
    const emailAccount = accountDocument({
      accountKind: "email",
      email: "mail@example.com",
      douyinId: "94946893573"
    });
    const lean = vi.fn(async () => [emailAccount]);
    const query = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 1);
    const aggregate = vi.fn(async () => [{ _id: "unsold", count: 1 }]);
    const distinct = vi.fn(async (field: string) =>
      field === "owner" ? ["邮箱归属人"] : ["94946893573"]
    );
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate, distinct })
    );

    const result = await service.list({
      accountKind: "email",
      keyword: "94946893573\n93180119509"
    });

    expect(result.items).toEqual([
      expect.objectContaining({ accountKind: "email", email: "mail@example.com" })
    ]);
    expect(find).toHaveBeenCalledWith({
      accountKind: "email",
      douyinId: { $in: ["94946893573", "93180119509"] }
    });
    expect(countDocuments).toHaveBeenCalledWith({
      accountKind: "email",
      douyinId: { $in: ["94946893573", "93180119509"] }
    });
    expect(countDocuments).toHaveBeenCalledWith({
      accountKind: "email",
      accountStatus: { $in: ["violation", "banned", "op_invalid"] }
    });
    expect(aggregate).toHaveBeenCalledWith([
      { $match: { accountKind: "email" } },
      { $group: { _id: "$saleStatus", count: { $sum: 1 } } }
    ]);
    expect(distinct).toHaveBeenCalledWith("douyinId", {
      accountKind: "email",
      douyinId: { $in: ["94946893573", "93180119509"] }
    });
    await expect(service.owners({ accountKind: "email" })).resolves.toEqual({
      items: ["邮箱归属人"]
    });
    expect(distinct).toHaveBeenCalledWith("owner", {
      accountKind: "email",
      owner: { $ne: "" }
    });
  });

  it("includes historical Google records in kind-scoped owner lists", async () => {
    const lean = vi.fn(async () => [accountDocument()]);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 0);
    const aggregate = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate })
    );

    const result = await service.list({ owner: "张三" });

    expect(find).toHaveBeenCalledWith({
      $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }],
      owner: "张三"
    });
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(countDocuments).toHaveBeenCalledWith({
      $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }],
      owner: "张三"
    });
    expect(result.items).toEqual([
      expect.objectContaining({ accountKind: "google", email: "" })
    ]);
  });

  it("matches each non-id keyword line and defaults to ascending registered time order", async () => {
    const lean = vi.fn(async () => []);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 0);
    const aggregate = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate })
    );

    await service.list({ keyword: "张三\nMS4wLjABAAAA-fixture" });

    const filter = ((find.mock.calls[0] as unknown[] | undefined)?.[0] ??
      {}) as Record<string, unknown>;
    expect(filter.searchText).toBeInstanceOf(RegExp);
    expect((filter.searchText as RegExp).test("张三")).toBe(true);
    expect((filter.searchText as RegExp).test("MS4wLjABAAAA-fixture")).toBe(true);
    expect(query.sort).toHaveBeenCalledWith({ registeredAt: 1, _id: 1 });
  });

  it("accepts 701 newline-separated Douyin ids and queries them exactly", async () => {
    const douyinIds = Array.from(
      { length: 701 },
      (_, index) => String(20_000_000_000 + index)
    );
    const lean = vi.fn(async () => []);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 0);
    const aggregate = vi.fn(async () => []);
    const distinct = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate, distinct })
    );

    await service.list({ keyword: douyinIds.join("\n") });

    const filter = ((find.mock.calls[0] as unknown[] | undefined)?.[0] ??
      {}) as Record<string, unknown>;
    expect(filter).not.toHaveProperty("searchText");
    expect(filter).toMatchObject({
      douyinId: {
        $in: expect.arrayContaining(["20000000000", "20000000700"])
      }
    });
    expect((filter.douyinId as { $in: string[] }).$in).toHaveLength(701);
  });

  it("returns missing douyin ids for multiline keyword searches", async () => {
    const lean = vi.fn(async () => [
      accountDocument({ douyinId: "94946893573" }),
      accountDocument({
        _id: "507f1f77bcf86cd799439012",
        douyinId: "93180119509"
      })
    ]);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 2);
    const aggregate = vi.fn(async () => []);
    const distinct = vi.fn(async () => ["94946893573", "93180119509"]);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate, distinct })
    );

    const result = await service.list({
      keyword: "94946893573\n93180119509\n56946848178"
    });

    expect(distinct).toHaveBeenCalledWith("douyinId", {
      $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }],
      douyinId: { $in: ["94946893573", "93180119509", "56946848178"] }
    });
    expect(result.searchSummary).toEqual({
      requested: 3,
      found: 2,
      missingKeywords: ["56946848178"]
    });
  });

  it("supports descending registered time order", async () => {
    const lean = vi.fn(async () => []);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 0);
    const aggregate = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate })
    );

    await service.list({ sortDirection: "desc" });

    expect(query.sort).toHaveBeenCalledWith({ registeredAt: -1, _id: -1 });
  });

  it("returns all matching accounts when pageSize is all", async () => {
    const lean = vi.fn(async () => []);
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean
    };
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const find = vi.fn(() => query);
    const countDocuments = vi.fn(async () => 42);
    const aggregate = vi.fn(async () => []);
    const service = createAccountsService(
      dependencies({ find, countDocuments, aggregate })
    );

    const result = await service.list({ pageSize: "all" });

    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      page: 1,
      pageSize: "all",
      total: 42,
      totalPages: 1
    });
  });
});
