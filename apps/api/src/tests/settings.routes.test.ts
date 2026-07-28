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
  it("returns default settings including the QQ proxy pool", async () => {
    vi.spyOn(SettingModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({
        key: "admin",
        defaultPageSize: 20,
        sessionHours: 12,
        qqOpSocksProxyPool: ""
      })
    } as never);
    const agent = await createAuthenticatedAgent();

    const response = await agent.get("/api/settings");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      defaultPageSize: 20,
      sessionHours: 12,
      qqOpSocksProxyPool: ""
    });
  });

  it("saves the multiline QQ proxy pool", async () => {
    vi.spyOn(SettingModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({
        key: "admin",
        defaultPageSize: 50,
        sessionHours: 24,
        qqOpSocksProxyPool:
          "127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"
      })
    } as never);
    const agent = await createAuthenticatedAgent();

    const response = await agent.patch("/api/settings").send({
      defaultPageSize: 50,
      sessionHours: 24,
      qqOpSocksProxyPool: "127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      defaultPageSize: 50,
      sessionHours: 24,
      qqOpSocksProxyPool:
        "127.0.0.1:1080\n198.64.244.205:50101:tztright:t5sYiBK8tD"
    });
  });
});
