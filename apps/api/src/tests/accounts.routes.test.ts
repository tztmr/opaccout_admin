import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import type { AccountsService } from "../services/accounts";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

describe("account routes", () => {
  it("requires login and forwards a validated create request", async () => {
    const create = vi.fn(async () => ({ _id: "account-id" }));
    const accountService = {
      create,
      list: vi.fn(),
      owners: vi.fn(),
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
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({ config: testConfig, adminAuth, accountService });

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
      registeredRegion: "中国.香港",
      saleStatus: "unsold",
      remark: ""
    });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });

  it("returns owner options before treating owners as an account id", async () => {
    const owners = vi.fn(async () => ({ items: ["小王", "张三"] }));
    const get = vi.fn();
    const accountService = {
      create: vi.fn(),
      list: vi.fn(),
      owners,
      check: vi.fn(),
      get,
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate: vi.fn(),
      recheck: vi.fn(),
      batchRecheck: vi.fn()
    } as unknown as AccountsService;
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.get("/api/accounts/owners");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: ["小王", "张三"] });
    expect(owners).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("accepts oversized search filters through a POST query endpoint", async () => {
    const list = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      stats: { total: 0, unsold: 0, sold: 0, abnormal: 0 }
    }));
    const accountService = {
      create: vi.fn(),
      list,
      owners: vi.fn(),
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
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/accounts/query").send({
      keyword: "94946893573\n93180119509",
      page: 1,
      pageSize: 20,
      sortDirection: "asc"
    });

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      keyword: "94946893573\n93180119509",
      page: 1,
      pageSize: 20,
      sortDirection: "asc"
    });
  });

  it("forwards an OP recheck request after login", async () => {
    const recheckOp = vi.fn(async () => ({ _id: "account-id", opName: "API昵称" }));
    const accountService = {
      create: vi.fn(),
      list: vi.fn(),
      owners: vi.fn(),
      check: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate: vi.fn(),
      recheck: vi.fn(),
      recheckOp,
      batchRecheck: vi.fn()
    } as unknown as AccountsService;
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/accounts/account-id/recheck-op");

    expect(response.status).toBe(200);
    expect(recheckOp).toHaveBeenCalledOnce();
    expect(recheckOp).toHaveBeenCalledWith(
      "account-id",
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it("forwards a batch OP recheck request after login", async () => {
    const batchRecheckOp = vi.fn(async () => ({ succeeded: [], failed: [] }));
    const accountService = {
      create: vi.fn(),
      list: vi.fn(),
      owners: vi.fn(),
      check: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate: vi.fn(),
      recheck: vi.fn(),
      recheckOp: vi.fn(),
      batchRecheck: vi.fn(),
      batchRecheckOp
    } as unknown as AccountsService;
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent
      .post("/api/accounts/batch-recheck-op")
      .send({ ids: ["a", "b"] });

    expect(response.status).toBe(200);
    expect(batchRecheckOp).toHaveBeenCalledOnce();
    expect(batchRecheckOp).toHaveBeenCalledWith(
      ["a", "b"],
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it("accepts registeredRegion in a batch update request", async () => {
    const batchUpdate = vi.fn(async () => ({ updated: 2 }));
    const accountService = {
      create: vi.fn(),
      list: vi.fn(),
      owners: vi.fn(),
      check: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate,
      recheck: vi.fn(),
      recheckOp: vi.fn(),
      batchRecheck: vi.fn(),
      batchRecheckOp: vi.fn()
    } as unknown as AccountsService;
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/accounts/batch-update").send({
      ids: ["a", "b"],
      registeredRegion: "中国.澳门"
    });

    expect(response.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledWith(
      ["a", "b"],
      { registeredRegion: "中国.澳门" },
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it("accepts remark in a batch update request", async () => {
    const batchUpdate = vi.fn(async () => ({ updated: 2 }));
    const accountService = {
      create: vi.fn(),
      list: vi.fn(),
      owners: vi.fn(),
      check: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      batchRemove: vi.fn(),
      reveal: vi.fn(),
      batchUpdate,
      recheck: vi.fn(),
      recheckOp: vi.fn(),
      batchRecheck: vi.fn(),
      batchRecheckOp: vi.fn()
    } as unknown as AccountsService;
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const agent = new request.agent(
      createApp({ config: testConfig, adminAuth, accountService })
    );
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/accounts/batch-update").send({
      ids: ["a", "b"],
      remark: "统一补充备注"
    });

    expect(response.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledWith(
      ["a", "b"],
      { remark: "统一补充备注" },
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });
});
