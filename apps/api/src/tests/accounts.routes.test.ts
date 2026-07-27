import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import type { AccountsService } from "../services/accounts";
import { testConfig } from "./test-config";

describe("account routes", () => {
  it("requires login and forwards a validated create request", async () => {
    const create = vi.fn(async () => ({ _id: "account-id" }));
    const accountService = {
      create,
      list: vi.fn(),
      check: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate: vi.fn(),
      recheck: vi.fn(),
      batchRecheck: vi.fn()
    } as unknown as AccountsService;
    const app = createApp({ config: testConfig, accountService });

    expect((await request(app).post("/api/accounts").send({})).status).toBe(401);

    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });
    const response = await agent.post("/api/accounts").send({
      douyinId: "94946893573",
      registeredAt: "2026-07-27",
      opName: "",
      opSecret: "a|b|1782303418",
      owner: "小王",
      saleStatus: "unsold",
      remark: ""
    });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });
});
