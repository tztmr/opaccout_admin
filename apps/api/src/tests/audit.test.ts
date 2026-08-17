import { describe, expect, it, vi } from "vitest";
import { createAuditService } from "../services/audit";

describe("audit service", () => {
  it("stores changed field names without sensitive values", async () => {
    const create = vi.fn(async (value: unknown) => value);
    const audit = createAuditService({ create });

    await audit.write({
      action: "account.updated",
      targetType: "account",
      targetIds: ["account-id"],
      changedFields: ["owner", "opSecret", "accountPassword", "secUid", "cookie"],
      count: 1,
      ip: "127.0.0.1",
      userAgent: "Browser\r\nInjected",
      requestId: "request-id"
    });

    expect(create).toHaveBeenCalledWith({
      action: "account.updated",
      targetType: "account",
      targetIds: ["account-id"],
      changedFields: ["owner", "opSecret", "accountPassword", "secUid"],
      count: 1,
      ip: "127.0.0.1",
      userAgent: "Browser Injected",
      requestId: "request-id"
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain("cookie");
  });
});
