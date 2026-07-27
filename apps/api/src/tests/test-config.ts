import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  adminUsername: "admin",
  adminPassword: "a-long-admin-password",
  sessionSecret: "a-session-secret-with-more-than-32-characters",
  sessionHours: 12,
  fieldEncryptionKey: randomBytes(32),
  mongoUri: "mongodb://unused/test",
  douyinCheckApiUrl: new URL("https://unid.tztright.top/check"),
  cookieSecure: false
};
