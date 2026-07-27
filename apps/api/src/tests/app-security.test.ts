import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

describe("application security", () => {
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
