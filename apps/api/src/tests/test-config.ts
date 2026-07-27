import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  sessionSecret: "a-session-secret-with-more-than-32-characters",
  sessionHours: 12,
  fieldEncryptionKey: randomBytes(32),
  mongoUri: "mongodb://unused/test",
  douyinCheckApiUrl: new URL("https://unid.tztright.top/check"),
  qqOpProfileApiUrl: new URL(
    "https://graph.qq.com/user/get_simple_userinfo"
  ),
  qqOpAppId: "1105602870",
  qqOpProfileTimeoutMs: 5000,
  cookieSecure: false
};
