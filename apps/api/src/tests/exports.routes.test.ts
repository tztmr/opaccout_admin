import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { AccountModel } from "../models/account";
import { createSecretCipher } from "../services/encryption";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

describe("exports routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports selected accounts via POST body ids", async () => {
    const lean = vi.fn(async () => []);
    const sort = vi.fn(() => ({ lean }));
    const find = vi.spyOn(AccountModel, "find").mockReturnValue({ sort } as never);
    const audit = { write: vi.fn(async () => undefined) };
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({
      config: testConfig,
      adminAuth,
      cipher: createSecretCipher(randomBytes(32)),
      audit
    });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/exports/accounts").send({
      format: "xlsx",
      ids: ["a", "b"]
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("douyin-google-accounts.xlsx");
    expect(find).toHaveBeenCalledWith({
      $and: [
        { $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }] },
        { _id: { $in: ["a", "b"] } }
      ]
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.exported",
        targetIds: ["a", "b"],
        accountKind: "google",
        changedFields: ["email", "opSecret", "accountPassword"]
      })
    );
  });

  it("exports filtered accounts via POST body filters", async () => {
    const lean = vi.fn(async () => []);
    const sort = vi.fn(() => ({ lean }));
    const find = vi.spyOn(AccountModel, "find").mockReturnValue({ sort } as never);
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const audit = { write: vi.fn(async () => undefined) };
    const app = createApp({
      config: testConfig,
      adminAuth,
      cipher: createSecretCipher(randomBytes(32)),
      audit
    });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/exports/accounts").send({
      format: "xlsx",
      accountKind: "email",
      owner: "张三",
      sortDirection: "desc"
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("douyin-email-accounts.xlsx");
    expect(find).toHaveBeenCalledWith({ accountKind: "email", owner: "张三" });
    expect(sort).toHaveBeenCalledWith({ registeredAt: -1, _id: -1 });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "account.exported",
      accountKind: "email",
      changedFields: ["email", "opSecret", "accountPassword"]
    }));
  });

  it("matches template kind queries with their download filenames", async () => {
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({
      config: testConfig,
      adminAuth,
      cipher: createSecretCipher(randomBytes(32))
    });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const [google, email] = await Promise.all([
      agent.get("/api/imports/template?format=xlsx"),
      agent.get("/api/imports/template?format=xlsx&accountKind=email")
    ]);

    expect(google.status).toBe(200);
    expect(google.headers["content-disposition"]).toContain("douyin-google-account-template.xlsx");
    expect(email.status).toBe(200);
    expect(email.headers["content-disposition"]).toContain("douyin-email-account-template.xlsx");
  });
});
