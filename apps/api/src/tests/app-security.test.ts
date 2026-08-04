import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import type { PublicOpService } from "../services/public-op";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

describe("application security", () => {
  it("keeps the public short OP API outside the administrator authentication boundary", async () => {
    const adminAuth = await createTestAdminAuth();
    const publicOpService: PublicOpService = {
      resolve: async () => ({
        status: "success" as const,
        code: "123456789",
        opData: "openid|access|pay",
        project: { key: "douyin", name: "抖音", appId: "1105602870" },
        expiresAt: "2026-08-23T12:16:58.000Z",
        wakeUrl: "tencent1105602870://qzapp/mqzone/0"
      })
    };
    const app = createApp({ config: testConfig, adminAuth, ...{ publicOpService } });

    const response = await request(app)
      .post("/api/op/resolve")
      .send({ code: "123456789" });

    expect(response.status).toBe(200);
  });

  it("protects management APIs", async () => {
    const adminAuth = await createTestAdminAuth();
    const response = await request(createApp({ config: testConfig, adminAuth })).get(
      "/api/test/protected"
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("sets defensive response headers", async () => {
    const adminAuth = await createTestAdminAuth();
    const response = await request(createApp({ config: testConfig, adminAuth })).get(
      "/api/auth/session"
    );

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("returns a normalized error for an oversized JSON body", async () => {
    const adminAuth = await createTestAdminAuth();
    const response = await request(createApp({ config: testConfig, adminAuth }))
      .post("/api/auth/login")
      .send({ username: "admin", password: "x".repeat(1_100_000) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("REQUEST_BODY_TOO_LARGE");
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});
