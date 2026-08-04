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
  douyinProfileApiUrl: new URL(
    "https://imdesktop.douyin.com/aweme/v1/web/user/profile/other/"
  ),
  qqOpProfileApiUrl: new URL(
    "https://graph.qq.com/user/get_simple_userinfo"
  ),
  qqOpSocksProxyUrls: [],
  qqOpAppId: "1105602870",
  qqOpProfileTimeoutMs: 5000,
  cookieSecure: false
};
