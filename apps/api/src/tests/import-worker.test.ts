import type { AccountInput } from "@douyin-admin/shared";
import { describe, expect, it, vi } from "vitest";
import type { AccountsService, AuditContext } from "../services/accounts";
import {
  classifyImportError,
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
