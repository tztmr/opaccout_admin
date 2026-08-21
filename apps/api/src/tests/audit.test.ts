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
      changedFields: ["email", "owner", "opSecret", "accountPassword", "secUid", "cookie"],
      count: 1,
      ip: "127.0.0.1",
      userAgent: "Browser\r\nInjected",
      requestId: "request-id",
      email: "mail@example.com",
      accountPassword: "douyin-pass",
      opSecret: "a|b|1782303418"
    } as never);

    expect(create).toHaveBeenCalledWith({
      action: "account.updated",
      targetType: "account",
      targetIds: ["account-id"],
      changedFields: ["email", "owner", "opSecret", "accountPassword", "secUid"],
      count: 1,
      ip: "127.0.0.1",
      userAgent: "Browser Injected",
      requestId: "request-id"
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain("cookie");
    expect(JSON.stringify(create.mock.calls)).not.toContain("mail@example.com");
    expect(JSON.stringify(create.mock.calls)).not.toContain("douyin-pass");
    expect(JSON.stringify(create.mock.calls)).not.toContain("a|b|1782303418");
  });
});
