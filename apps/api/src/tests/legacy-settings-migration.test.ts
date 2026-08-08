import { describe, expect, it, vi } from "vitest";
import * as settingModule from "../models/setting";

describe("legacy settings migration", () => {
  it("removes the retired QQ OP proxy field from every stored admin setting", async () => {
    const updateMany = vi.fn(async () => ({ modifiedCount: 2 }));
    const removeLegacyOpProxySettings = (
      settingModule as typeof settingModule & {
        removeLegacyOpProxySettings?: (
          collection: { updateMany: typeof updateMany }
        ) => Promise<number>;
      }
    ).removeLegacyOpProxySettings;

    expect(removeLegacyOpProxySettings).toBeTypeOf("function");
    await expect(removeLegacyOpProxySettings!({ updateMany })).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith(
      { qqOpSocksProxyPool: { $exists: true } },
      { $unset: { qqOpSocksProxyPool: "" } }
    );
  });
});
