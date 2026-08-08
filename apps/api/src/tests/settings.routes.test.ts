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

  it("rejects the removed QQ proxy pool field", async () => {
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
