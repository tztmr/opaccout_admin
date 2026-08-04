import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PublicOpResolveResponse } from "@douyin-admin/shared";
import { createApp } from "../app";
import { createPublicOpService } from "../services/public-op";
import type { PublicOpService } from "../services/public-op";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

const fixtureOp = "openid-fixture|access-token-fixture|pay-token-fixture|pfkey-fixture|1782303418";
const fixtureResponse = {
  status: "success" as const,
  code: "123456789",
  opData: fixtureOp,
  project: { key: "douyin", name: "抖音", appId: "1105602870" },
  expiresAt: "2026-08-23T12:16:58.000Z",
  wakeUrl: "tencent1105602870://qzapp/mqzone/0?objectlocation=url"
} satisfies PublicOpResolveResponse;

function twoProxyChain(publicClientIp: string, forgedLeftIp?: string): string {
  return [forgedLeftIp, publicClientIp, "172.20.0.10", "10.20.0.10"]
    .filter((ip): ip is string => Boolean(ip))
    .join(", ");
}

async function createPublicApp(
  resolve: PublicOpService["resolve"] = async () => fixtureResponse
) {
  const adminAuth = await createTestAdminAuth();
  const publicOpService = { resolve };
  const app = createApp({ config: testConfig, adminAuth, ...{ publicOpService } });
  return { app, resolve };
}

describe("public short OP resolve route", () => {
  it("allows an anonymous request to resolve a valid short OP without caching it", async () => {
    const { app } = await createPublicApp();

    const response = await request(app)
      .post("/api/op/resolve")
      .send({ code: "123456789" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(fixtureResponse);
  });

  it("rejects a malformed or non-strict request without caching the error", async () => {
    const { app } = await createPublicApp();

    for (const body of [{ code: "123" }, { code: "123456789", extra: true }]) {
      const response = await request(app).post("/api/op/resolve").send(body);
      expect(response.status).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ error: "请输入正确的 9 位短码" });
    }
  });

  it("returns a generic non-cached validation error for malformed JSON before the public route", async () => {
    const { app } = await createPublicApp();

    const response = await request(app)
      .post("/api/op/resolve")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ error: "请输入正确的 9 位短码" });
    expect(JSON.stringify(response.body)).not.toContain(fixtureOp);
  });

  it("uses the same not-found response for a missing, expired, invalid, unknown-project, or undecryptable OP", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const { app } = await createPublicApp(resolve);

    for (let index = 0; index < 5; index += 1) {
      const response = await request(app)
        .post("/api/op/resolve")
        .send({ code: "123456789" });
      expect(response.status).toBe(404);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ error: "短 OP 无效或已过期" });
      expect(JSON.stringify(response.body)).not.toContain(fixtureOp);
    }
  });

  it("keeps two public clients separate after two trusted proxy hops", async () => {
    const { app } = await createPublicApp();

    for (let index = 0; index < 30; index += 1) {
      await request(app)
        .post("/api/op/resolve")
        .set("X-Forwarded-For", twoProxyChain("198.51.100.10"))
        .send({ code: "123456789" })
        .expect(200);
    }

    const response = await request(app)
      .post("/api/op/resolve")
      .set("X-Forwarded-For", twoProxyChain("198.51.100.11"))
      .send({ code: "123456789" });
    expect(response.status).toBe(200);
  });

  it("does not let a forged left-side forwarding address bypass a public client limit", async () => {
    const { app } = await createPublicApp();

    for (let index = 0; index < 30; index += 1) {
      await request(app)
        .post("/api/op/resolve")
        .set("X-Forwarded-For", twoProxyChain("198.51.100.10", "203.0.113.200"))
        .send({ code: "123456789" })
        .expect(200);
    }

    const response = await request(app)
      .post("/api/op/resolve")
      .set("X-Forwarded-For", twoProxyChain("198.51.100.10"))
      .send({ code: "123456789" });
    expect(response.status).toBe(429);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.body)).not.toContain(fixtureOp);
  });
});

describe("public short OP service", () => {
  it("does not disclose OP data from a missing, expired, invalid, unknown-project, or undecryptable record", async () => {
    const baseAccount = {
      shortOpCode: "123456789",
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      accountStatus: "normal",
      opProject: "douyin",
      opSecret: { version: 1 as const, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" }
    };
    const cases = [
      { account: null, decrypt: () => fixtureOp },
      { account: { ...baseAccount, opExpiresAt: new Date("2026-08-03T12:16:58.000Z") }, decrypt: () => fixtureOp },
      { account: { ...baseAccount, accountStatus: "op_invalid" }, decrypt: () => fixtureOp },
      { account: { ...baseAccount, opProject: "unknown" }, decrypt: () => fixtureOp },
      { account: baseAccount, decrypt: () => { throw new Error("cipher failed"); } }
    ];

    for (const { account, decrypt } of cases) {
      const model = {
        findOne: () => ({ lean: async () => account })
      };
      const service = createPublicOpService({
        model,
        cipher: { encrypt: vi.fn(), decrypt },
        now: () => new Date("2026-08-04T12:16:58.000Z"),
        buildWakeUrl: () => fixtureResponse.wakeUrl
      });

      await expect(service.resolve("123456789")).resolves.toBeNull();
    }
  });

  it("returns the decrypted OP, project, expiry, and wake URL for a current valid record", async () => {
    const account = {
      shortOpCode: "123456789",
      opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
      accountStatus: "normal",
      opProject: "douyin",
      opSecret: { version: 1 as const, iv: "aXY=", ciphertext: "Y2lwaGVy", authTag: "dGFn" }
    };
    const service = createPublicOpService({
      model: { findOne: () => ({ lean: async () => account }) },
      cipher: { encrypt: vi.fn(), decrypt: () => fixtureOp },
      now: () => new Date("2026-08-04T12:16:58.000Z"),
      buildWakeUrl: () => fixtureResponse.wakeUrl
    });

    await expect(service.resolve("123456789")).resolves.toEqual(fixtureResponse);
  });
});
