import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "a-long-admin-password",
  SESSION_SECRET: "a-session-secret-with-more-than-32-characters",
  SESSION_HOURS: "12",
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MONGO_URI: "mongodb://admin:password@mongo:27017/douyin?authSource=admin",
  DOUYIN_CHECK_API_URL: "https://unid.tztright.top/check"
};

describe("loadConfig", () => {
  it("loads strict environment configuration", () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3000);
    expect(config.cookieSecure).toBe(false);
    expect(config.fieldEncryptionKey).toHaveLength(32);
  });

  it("requires an HTTPS Douyin API URL", () => {
    expect(() =>
      loadConfig({ ...validEnv, DOUYIN_CHECK_API_URL: "http://example.com/check" })
    ).toThrow();
  });

  it("requires exactly 32 encryption-key bytes", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        FIELD_ENCRYPTION_KEY: randomBytes(16).toString("base64")
      })
    ).toThrow("FIELD_ENCRYPTION_KEY");
  });
});
