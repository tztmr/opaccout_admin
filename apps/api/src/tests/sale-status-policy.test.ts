import { describe, expect, it, vi } from "vitest";
import {
  assertBannedSaleStatusChange,
  normalizeBannedSaleStatuses,
  resolveDetectedSaleStatus
} from "../services/sale-status-policy";

describe("banned sale-status policy", () => {
  it("forces detected banned accounts to disabled", () => {
    expect(resolveDetectedSaleStatus("banned", "recovered")).toBe("disabled");
    expect(resolveDetectedSaleStatus("normal", "recovered")).toBe("recovered");
  });

  it("rejects manually unlocking a banned account", () => {
    expect(() => assertBannedSaleStatusChange("banned", "sold"))
      .toThrow("封禁账号的售卖状态必须保持为已停用");
    expect(() => assertBannedSaleStatusChange("banned", "disabled")).not.toThrow();
  });

  it("normalizes legacy banned records", async () => {
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });

    await expect(normalizeBannedSaleStatuses({ updateMany } as never)).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      { accountStatus: "banned", saleStatus: { $ne: "disabled" } },
      { $set: { saleStatus: "disabled" } }
    );
  });
});
