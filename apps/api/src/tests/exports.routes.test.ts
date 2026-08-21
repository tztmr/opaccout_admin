import { randomBytes } from "node:crypto";
import {
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  type AccountColumnId,
  type AccountKind
} from "@douyin-admin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { AccountModel } from "../models/account";
import { getAccountColumnOrder } from "../services/account-column-settings";
import { createSecretCipher } from "../services/encryption";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

vi.mock("../services/account-column-settings", () => ({
  getAccountColumnOrder: vi.fn()
}));

const getSavedColumnOrder = vi.mocked(getAccountColumnOrder);

describe("exports routes", () => {
  beforeEach(() => {
    getSavedColumnOrder.mockReset();
    getSavedColumnOrder.mockImplementation(async (accountKind: AccountKind) => [
      ...DEFAULT_ACCOUNT_COLUMN_ORDER[accountKind]
    ]);
  });

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
        changedFields: DEFAULT_ACCOUNT_COLUMN_ORDER.google
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
      changedFields: DEFAULT_ACCOUNT_COLUMN_ORDER.email
    }));
  });

  it("uses the same saved order for selected and filtered exports and ignores body order", async () => {
    const savedOrder: AccountColumnId[] = [
      "remark", "mobile", "shortop", "douyin", "password", "secuid",
      "date", "opname", "opsecret", "project", "expiry", "owner",
      "region", "sale", "status"
    ];
    getSavedColumnOrder.mockResolvedValue(savedOrder);
    const lean = vi.fn(async () => []);
    const sort = vi.fn(() => ({ lean }));
    vi.spyOn(AccountModel, "find").mockReturnValue({ sort } as never);
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

    const selected = await agent.post("/api/exports/accounts").send({
      format: "csv",
      ids: ["selected-id"],
      columnOrder: ["douyin"]
    });
    const filtered = await agent.post("/api/exports/accounts").send({
      format: "csv",
      owner: "张三",
      columnOrder: ["douyin"]
    });
    const expectedHeader =
      "备注,手机号,短 OP,抖音号,密码,sec_uid,注册时间,OP名称,OP卡密,项目,OP到期时间,归属人,注册地区,售卖状态,账号状态";

    expect(selected.status).toBe(200);
    expect(filtered.status).toBe(200);
    expect(selected.text.trim()).toBe(expectedHeader);
    expect(filtered.text.trim()).toBe(expectedHeader);
    expect(getSavedColumnOrder.mock.calls).toEqual([["google"], ["google"]]);
    expect(audit.write).toHaveBeenNthCalledWith(1, expect.objectContaining({
      targetIds: ["selected-id"],
      changedFields: savedOrder
    }));
    expect(audit.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
      targetIds: [],
      changedFields: savedOrder
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
