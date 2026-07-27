import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { testConfig } from "./test-config";

describe("authentication routes", () => {
  it("rejects invalid credentials without identifying the bad field", async () => {
    const response = await request(createApp({ config: testConfig }))
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "用户名或密码错误"
    });
  });

  it("sets an HttpOnly SameSite cookie and exposes the session", async () => {
    const agent = new request.agent(createApp({ config: testConfig }));
    const login = await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");

    const session = await agent.get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ authenticated: true, username: "admin" });
  });

  it("destroys the server-side session on logout", async () => {
    const agent = new request.agent(createApp({ config: testConfig }));
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });
});
