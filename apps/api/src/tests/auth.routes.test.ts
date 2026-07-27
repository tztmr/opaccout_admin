import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

const credentials = {
  username: "admin",
  password: "a-long-admin-password"
};

async function setupApp(initial = false) {
  const adminAuth = await createTestAdminAuth(initial ? credentials : undefined);
  return createApp({ config: testConfig, adminAuth });
}

describe("authentication routes", () => {
  it("reports setup only before an administrator exists", async () => {
    const empty = await request(await setupApp()).get("/api/auth/setup");
    expect(empty.body).toEqual({ needsSetup: true });
    expect(empty.headers["cache-control"]).toBe("no-store");
    expect((await request(await setupApp(true)).get("/api/auth/setup")).body)
      .toEqual({ needsSetup: false });
  });

  it("creates the first administrator and starts its session", async () => {
    const agent = new request.agent(await setupApp());
    const setup = await agent.post("/api/auth/setup").send(credentials);

    expect(setup.status).toBe(201);
    expect(setup.body).toEqual({ authenticated: true, username: "admin" });
    expect(setup.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect((await agent.get("/api/auth/session")).body).toEqual({
      authenticated: true,
      username: "admin"
    });
    expect((await agent.get("/api/auth/setup")).body)
      .toEqual({ needsSetup: false });
  });

  it("rejects setup after the administrator exists", async () => {
    const app = await setupApp(true);
    const response = await request(app).post("/api/auth/setup").send({
      username: "replacement",
      password: "another-long-password"
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ADMIN_ALREADY_EXISTS");
  });

  it("validates setup credentials", async () => {
    const response = await request(await setupApp())
      .post("/api/auth/setup")
      .send({ username: "admin", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("requires setup before login", async () => {
    const response = await request(await setupApp())
      .post("/api/auth/login")
      .send(credentials);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SETUP_REQUIRED");
  });

  it("rejects invalid credentials without identifying the bad field", async () => {
    const response = await request(await setupApp(true))
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "用户名或密码错误"
    });
  });

  it("sets an HttpOnly SameSite cookie and exposes the session", async () => {
    const agent = new request.agent(await setupApp(true));
    const login = await agent.post("/api/auth/login").send(credentials);

    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
    expect((await agent.get("/api/auth/session")).body).toEqual({
      authenticated: true,
      username: "admin"
    });
  });

  it("destroys the server-side session on logout", async () => {
    const agent = new request.agent(await setupApp(true));
    await agent.post("/api/auth/login").send(credentials);

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });
});
