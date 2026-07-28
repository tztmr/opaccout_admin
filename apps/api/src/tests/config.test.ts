import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
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
    expect(config.qqOpProfileApiUrl.href).toBe(
      "https://graph.qq.com/user/get_simple_userinfo"
    );
    expect(config.qqOpAppId).toBe("1105602870");
    expect(config.qqOpProfileTimeoutMs).toBe(5000);
    expect(config.qqOpSocksProxyUrls).toEqual([]);
  });

  it("does not load obsolete administrator credentials", () => {
    const config = loadConfig({
      ...validEnv,
      ADMIN_USERNAME: "ignored",
      ADMIN_PASSWORD: "ignored-long-password"
    });

    expect(config).not.toHaveProperty("adminUsername");
    expect(config).not.toHaveProperty("adminPassword");
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

  it("requires an HTTPS QQ OP profile API URL", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        QQ_OP_PROFILE_API_URL:
          "http://graph.qq.com/user/get_simple_userinfo"
      })
    ).toThrow("QQ_OP_PROFILE_API_URL");
  });

  it("bounds the QQ OP timeout", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        QQ_OP_PROFILE_TIMEOUT_MS: "99"
      })
    ).toThrow();
  });

  it("loads an optional QQ OP SOCKS proxy URL", () => {
    const config = loadConfig({
      ...validEnv,
      QQ_OP_SOCKS_PROXY_URL: "socks5://127.0.0.1:1080"
    });

    expect(config.qqOpSocksProxyUrls.map((item) => item.href))
      .toEqual(["socks5://127.0.0.1:1080"]);
  });

  it("supports a QQ OP SOCKS proxy pool in mixed formats", () => {
    const config = loadConfig({
      ...validEnv,
      QQ_OP_SOCKS_PROXY_URL: [
        "198.64.244.205:50101:tztright:t5sYiBK8tD",
        "127.0.0.1:1081",
        "user:pass@10.0.0.2:9000",
        "socks5://127.0.0.1:1082"
      ].join(",")
    });

    expect(config.qqOpSocksProxyUrls.map((item) => item.href)).toEqual([
      "socks5://tztright:t5sYiBK8tD@198.64.244.205:50101",
      "socks5://127.0.0.1:1081",
      "socks5://user:pass@10.0.0.2:9000",
      "socks5://127.0.0.1:1082"
    ]);
  });

  it("rejects a non-SOCKS QQ OP proxy URL", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        QQ_OP_SOCKS_PROXY_URL: "http://127.0.0.1:1080"
      })
    ).toThrow("QQ_OP_SOCKS_PROXY_URL");
  });

  it("rejects malformed bare QQ OP proxy entries", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        QQ_OP_SOCKS_PROXY_URL: "127.0.0.1:1080:user-only"
      })
    ).toThrow("QQ_OP_SOCKS_PROXY_URL");
  });
});
