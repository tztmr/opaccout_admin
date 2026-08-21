import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { SettingModel } from "../models/setting";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

const credentials = {
  username: "admin",
  password: "a-long-admin-password"
};

async function createAuthenticatedAgent() {
  const adminAuth = await createTestAdminAuth(credentials);
  const app = createApp({ config: testConfig, adminAuth });
  const agent = new request.agent(app);
  await agent.post("/api/auth/login").send(credentials);
  return agent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings routes", () => {
  it("returns normalized default orders for both account kinds", async () => {
    vi.spyOn(SettingModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({
        key: "admin",
        defaultPageSize: 20,
        sessionHours: 12
      })
    } as never);
    const agent = await createAuthenticatedAgent();

    const response = await agent.get("/api/settings/account-columns");

    expect(response.status).toBe(200);
    expect(response.body.google.slice(0, 4)).toEqual([
      "douyin", "password", "secuid", "date"
    ]);
    expect(response.body.email.slice(0, 4)).toEqual([
      "douyin", "email", "password", "secuid"
    ]);
  });

  it("saves only the normalized email order", async () => {
    const settings = {
      key: "admin" as const,
      defaultPageSize: 50,
      sessionHours: 24,
      googleColumnOrder: ["douyin", "password", "remark"],
      emailColumnOrder: ["douyin", "email", "password"]
    };
    vi.spyOn(SettingModel, "findOneAndUpdate").mockImplementation((_filter, update) => {
      const set = (update as { $set?: Partial<typeof settings> }).$set;
      if (set) Object.assign(settings, set);
      return { lean: async () => ({ ...settings }) } as never;
    });
    const agent = await createAuthenticatedAgent();

    const response = await agent.patch("/api/settings/account-columns/email").send({
      order: ["remark", "email", "douyin"]
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accountKind: "email" });
    expect(response.body.order.slice(0, 3)).toEqual(["remark", "email", "douyin"]);
    expect(settings.googleColumnOrder).toEqual(["douyin", "password", "remark"]);
    expect(settings.emailColumnOrder.slice(0, 3)).toEqual(["remark", "email", "douyin"]);
  });

  it("rejects invalid account kinds and extra PATCH fields", async () => {
    const agent = await createAuthenticatedAgent();

    const invalidKind = await agent.patch("/api/settings/account-columns/not-a-kind").send({
      order: ["douyin"]
    });
    const extraField = await agent.patch("/api/settings/account-columns/google").send({
      order: ["douyin"],
      defaultPageSize: 100
    });

    expect(invalidKind.status).toBe(400);
    expect(extraField.status).toBe(400);
  });

  it("does not expose a legacy QQ proxy pool setting", async () => {
    vi.spyOn(SettingModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({
        key: "admin",
        defaultPageSize: 20,
        sessionHours: 12,
        qqOpSocksProxyPool: "socks5://127.0.0.1:1080"
      })
    } as never);
    const agent = await createAuthenticatedAgent();

    const response = await agent.get("/api/settings");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      defaultPageSize: 20,
      sessionHours: 12
    });
    expect(response.body).not.toHaveProperty("qqOpSocksProxyPool");
  });

  it("accepts only defaultPageSize and sessionHours on the existing settings PATCH", async () => {
    vi.spyOn(SettingModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({
        key: "admin",
        defaultPageSize: 50,
        sessionHours: 24
      })
    } as never);
    const agent = await createAuthenticatedAgent();

    const response = await agent.patch("/api/settings").send({
      defaultPageSize: 50,
      sessionHours: 24,
      qqOpSocksProxyPool: "socks5://127.0.0.1:1080"
    });

    expect(response.status).toBe(400);
  });
});
