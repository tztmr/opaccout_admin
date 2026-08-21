import { AccountPatchSchema, type AccountInput } from "@douyin-admin/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountModel } from "../models/account";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import type { AccountsService, AuditContext } from "../services/accounts";
import {
  classifyImportError,
  processNextImportJob,
  processImportRow,
  summarizeImportErrors
} from "../services/import-worker";
import { DouyinCheckError } from "../services/douyin-check";
import { AppError } from "../middleware/errors";

const input: AccountInput = {
  douyinId: "94946893573",
  registeredAt: "2026-07-28",
  opName: "导入名称",
  opSecret: "openid|token|pay|pfkey|1782303418",
  opProject: "douyin",
  owner: "小王",
  registeredRegion: "中国.香港",
  saleStatus: "unknown",
  remark: ""
};
const context: AuditContext = {
  ip: "127.0.0.1",
  userAgent: "test",
  requestId: "import-test"
};

afterEach(() => {
  vi.restoreAllMocks();
});

function accountServiceStub() {
  return {
    create: vi.fn(async () => ({ _id: "created-id", opName: "API昵称" })),
    update: vi.fn(async () => ({ _id: "updated-id", opName: "" })),
    recheck: vi.fn(async () => ({})),
    recheckOp: vi.fn(async () => ({ _id: "updated-id", opName: "" }))
  } as unknown as AccountsService;
}

describe("processImportRow", () => {
  it("creates a new row", async () => {
    const accounts = accountServiceStub();
    const result = await processImportRow(
      accounts,
      input,
      "skip",
      context,
      vi.fn(async () => null)
    );

    expect(result).toBe("created");
    expect(accounts.create).toHaveBeenCalledOnce();
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("skips an existing row without invoking account writes", async () => {
    const accounts = accountServiceStub();
    const result = await processImportRow(
      accounts,
      input,
      "skip",
      context,
      vi.fn(async () => ({ _id: "existing-id" }))
    );

    expect(result).toBe("skipped");
    expect(accounts.create).not.toHaveBeenCalled();
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("updates an existing row without invoking create", async () => {
    const accounts = accountServiceStub();
    const result = await processImportRow(
      accounts,
      input,
      "update",
      context,
      vi.fn(async () => ({ _id: "existing-id" }))
    );

    expect(result).toBe("updated");
    expect(accounts.update).toHaveBeenCalledWith(
      "existing-id",
      input,
      context
    );
    expect(accounts.recheck).toHaveBeenCalledWith("existing-id", context);
    expect(accounts.recheckOp).toHaveBeenCalledWith("existing-id", context);
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it("updates a same-kind email row through the strict account patch schema", async () => {
    const accounts = accountServiceStub();
    const emailInput: AccountInput = {
      ...input,
      accountKind: "email",
      email: "mail@example.com"
    };
    vi.mocked(accounts.update).mockImplementation(async (_id, rawPatch) => {
      AccountPatchSchema.parse(rawPatch);
      return { _id: "updated-id", opName: "" } as never;
    });

    const result = await processImportRow(
      accounts,
      emailInput,
      "update",
      context,
      vi.fn(async () => ({ _id: "email-id", accountKind: "email" as const }))
    );

    expect(result).toBe("updated");
    expect(accounts.update).toHaveBeenCalledWith(
      "email-id",
      expect.objectContaining({ email: "mail@example.com" }),
      context
    );
    expect(accounts.create).not.toHaveBeenCalled();
  });

  it.each(["skip", "update"] as const)("rejects a cross-kind duplicate with the %s strategy without writing", async (duplicateStrategy) => {
    const accounts = accountServiceStub();
    const emailInput: AccountInput = {
      ...input,
      accountKind: "email",
      email: "mail@example.com"
    };

    await expect(processImportRow(
      accounts,
      emailInput,
      duplicateStrategy,
      context,
      vi.fn(async () => ({ _id: "google-id", accountKind: "google" as const }))
    )).rejects.toMatchObject({ code: "DOUYIN_ID_DUPLICATE" });
    expect(accounts.create).not.toHaveBeenCalled();
    expect(accounts.update).not.toHaveBeenCalled();
  });

  it("does not OP recheck an imported existing account detected as banned", async () => {
    const accounts = accountServiceStub();
    vi.mocked(accounts.recheck).mockResolvedValueOnce({
      accountStatus: "banned",
      opName: "封禁账号"
    } as never);

    const result = await processImportRow(
      accounts,
      input,
      "update",
      context,
      vi.fn(async () => ({ _id: "existing-id" }))
    );

    expect(result).toBe("updated");
    expect(accounts.recheck).toHaveBeenCalledWith("existing-id", context);
    expect(accounts.recheckOp).not.toHaveBeenCalled();
  });

  it("retries a retryable import failure once before succeeding", async () => {
    const accounts = accountServiceStub();
    vi.mocked(accounts.create)
      .mockRejectedValueOnce(new DouyinCheckError("DOUYIN_TIMEOUT", true))
      .mockResolvedValueOnce({ _id: "created-id", opName: "API昵称" } as never);

    const result = await processImportRow(
      accounts,
      input,
      "skip",
      context,
      vi.fn(async () => null)
    );

    expect(result).toBe("created");
    expect(accounts.create).toHaveBeenCalledTimes(2);
  });

  it("backfills an unknown OP name after import when detection returns empty", async () => {
    const accounts = accountServiceStub();
    vi.mocked(accounts.create).mockResolvedValueOnce({
      _id: "created-id",
      opName: ""
    } as never);

    await processImportRow(
      accounts,
      input,
      "skip",
      context,
      vi.fn(async () => null)
    );

    expect(accounts.update).toHaveBeenCalledWith(
      "created-id",
      { opName: "-未知-" },
      context
    );
  });

  it("classifies douyin and app errors for import failure reporting", () => {
    expect(
      classifyImportError(new DouyinCheckError("DOUYIN_TIMEOUT", true))
    ).toEqual({
      code: "DOUYIN_TIMEOUT",
      message: "抖音检测超时"
    });
    expect(
      classifyImportError(new AppError(409, "DOUYIN_ID_DUPLICATE", "抖音号已存在"))
    ).toEqual({
      code: "DOUYIN_ID_DUPLICATE",
      message: "抖音号已存在"
    });
    expect(classifyImportError(new Error("boom"))).toEqual({
      code: "IMPORT_ROW_FAILED",
      message: "导入失败"
    });
  });

  it("summarizes repeated import row errors", () => {
    expect(
      summarizeImportErrors([
        {
          row: 2,
          douyinId: "1",
          code: "DOUYIN_TIMEOUT",
          message: "抖音检测超时"
        },
        {
          row: 3,
          douyinId: "2",
          code: "DOUYIN_TIMEOUT",
          message: "抖音检测超时"
        },
        {
          row: 4,
          douyinId: "3",
          code: "DOUYIN_NETWORK_ERROR",
          message: "抖音检测网络异常"
        }
      ])
    ).toBe("失败 3 条：抖音检测超时×2、抖音检测网络异常×1");
  });
});

describe("processNextImportJob", () => {
  it("decrypts a staged account password before calling the account service", async () => {
    const encryptedOpSecret = {
      version: 1 as const,
      iv: "b3AtaXY=",
      ciphertext: "b3AtY2lwaGVydGV4dA==",
      authTag: "b3AtdGFn"
    };
    const encryptedPassword = {
      version: 1 as const,
      iv: "cGFzc3dvcmQtaXY=",
      ciphertext: "cGFzc3dvcmQtY2lwaGVydGV4dA==",
      authTag: "cGFzc3dvcmQtdGFn"
    };
    const job = {
      id: "job-id",
      previewId: "preview-id",
      duplicateStrategy: "skip" as const,
      status: "running" as const,
      processed: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      save: vi.fn(async () => undefined),
      set: vi.fn()
    };
    vi.spyOn(ImportJobModel, "findOneAndUpdate").mockResolvedValue(job as never);
    vi.spyOn(ImportPreviewModel, "findById").mockResolvedValue({
      _id: "preview-id",
      stagedRows: [{
        ...input,
        opSecret: encryptedOpSecret,
        accountPassword: encryptedPassword
      }]
    } as never);
    vi.spyOn(ImportPreviewModel, "findByIdAndDelete").mockResolvedValue(null);
    vi.spyOn(AccountModel, "findOne").mockReturnValue({
      select: () => ({ lean: async () => null })
    } as never);
    const accounts = accountServiceStub();
    const cipher = {
      encrypt: vi.fn(),
      decrypt: vi.fn((value) => value === encryptedPassword
        ? "import-pass"
        : "openid|token|pay|pfkey|1782303418")
    };

    await processNextImportJob(accounts, cipher);

    expect(accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountPassword: "import-pass" }),
      expect.objectContaining({ userAgent: "import-worker" })
    );
  });

  it("uses the preview kind for legacy staged rows without a kind", async () => {
    const job = {
      id: "job-id",
      previewId: "preview-id",
      accountKind: "google",
      duplicateStrategy: "skip" as const,
      status: "running" as const,
      processed: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      save: vi.fn(async () => undefined),
      set: vi.fn()
    };
    vi.spyOn(ImportJobModel, "findOneAndUpdate").mockResolvedValue(job as never);
    vi.spyOn(ImportPreviewModel, "findById").mockResolvedValue({
      _id: "preview-id",
      accountKind: "email",
      stagedRows: [{ ...input, accountKind: undefined, email: undefined }]
    } as never);
    vi.spyOn(ImportPreviewModel, "findByIdAndDelete").mockResolvedValue(null);
    vi.spyOn(AccountModel, "findOne").mockReturnValue({
      select: () => ({ lean: async () => null })
    } as never);
    const accounts = accountServiceStub();
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn(() => "openid|token|pay|pfkey|1782303418") };

    await processNextImportJob(accounts, cipher);

    expect(accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountKind: "email", email: "" }),
      expect.anything()
    );
  });

  it("defaults legacy previews and jobs without a kind to Google", async () => {
    const job = {
      id: "job-id",
      previewId: "preview-id",
      duplicateStrategy: "skip" as const,
      status: "running" as const,
      processed: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      save: vi.fn(async () => undefined),
      set: vi.fn()
    };
    vi.spyOn(ImportJobModel, "findOneAndUpdate").mockResolvedValue(job as never);
    vi.spyOn(ImportPreviewModel, "findById").mockResolvedValue({
      _id: "preview-id",
      stagedRows: [{ ...input, accountKind: undefined, email: undefined }]
    } as never);
    vi.spyOn(ImportPreviewModel, "findByIdAndDelete").mockResolvedValue(null);
    vi.spyOn(AccountModel, "findOne").mockReturnValue({
      select: () => ({ lean: async () => null })
    } as never);
    const accounts = accountServiceStub();
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn(() => "openid|token|pay|pfkey|1782303418") };

    await processNextImportJob(accounts, cipher);

    expect(accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountKind: "google", email: "" }),
      expect.anything()
    );
  });
});
