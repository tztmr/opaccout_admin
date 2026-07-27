import { describe, expect, it, vi } from "vitest";
import { exportAccounts } from "../services/exporter";

describe("exportAccounts", () => {
  it("exports unknown sale status with its Chinese label", () => {
    const output = exportAccounts([{
      _id: "507f1f77bcf86cd799439011",
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
      accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
      remark: "",
      searchText: "",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      updatedAt: new Date("2026-07-28T00:00:00.000Z")
    }], {
      encrypt: vi.fn(() => ({
        version: 1 as const,
        iv: "aXY=",
        ciphertext: "Y2lwaGVy",
        authTag: "dGFn"
      })),
      decrypt: vi.fn(() => "a|b|1782303418")
    }, "csv").toString("utf8");

    expect(output).toContain("未知");
  });
});
