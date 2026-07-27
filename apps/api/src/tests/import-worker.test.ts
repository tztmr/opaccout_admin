import type { AccountInput } from "@douyin-admin/shared";
import { describe, expect, it, vi } from "vitest";
import type { AccountsService, AuditContext } from "../services/accounts";
import { processImportRow } from "../services/import-worker";

const input: AccountInput = {
  douyinId: "94946893573",
  registeredAt: "2026-07-28",
  opName: "导入名称",
  opSecret: "openid|token|pay|pfkey|1782303418",
  owner: "小王",
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
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({}))
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
    expect(accounts.create).not.toHaveBeenCalled();
  });
});
