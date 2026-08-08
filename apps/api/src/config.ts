import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  SESSION_SECRET: z.string().min(32),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  MONGO_URI: z.string().min(1),
  DOUYIN_CHECK_API_URL: z.url().refine((value) => new URL(value).protocol === "https:", {
    message: "DOUYIN_CHECK_API_URL must use HTTPS"
  }),
  DOUYIN_PROFILE_API_URL: z
    .url()
    .default("https://imdesktop.douyin.com/aweme/v1/web/user/profile/other/")
    .refine((value) => new URL(value).protocol === "https:", {
      message: "DOUYIN_PROFILE_API_URL must use HTTPS"
    }),
  QQ_OP_PROFILE_API_URL: z
    .url()
    .default("https://graph.qq.com/user/get_simple_userinfo")
    .refine((value) => new URL(value).protocol === "https:", {
      message: "QQ_OP_PROFILE_API_URL must use HTTPS"
    }),
  QQ_OP_APP_ID: z.string().trim().min(1).max(100).default("1105602870"),
  QQ_OP_PROFILE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(5_000)
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  sessionSecret: string;
  sessionHours: number;
  fieldEncryptionKey: Buffer;
  mongoUri: string;
  douyinCheckApiUrl: URL;
  douyinProfileApiUrl: URL;
  qqOpProfileApiUrl: URL;
  qqOpAppId: string;
  qqOpProfileTimeoutMs: number;
  cookieSecure: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string>): AppConfig {
  const parsed = EnvironmentSchema.parse(env);
  const fieldEncryptionKey = Buffer.from(parsed.FIELD_ENCRYPTION_KEY, "base64");

  if (fieldEncryptionKey.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    sessionSecret: parsed.SESSION_SECRET,
    sessionHours: parsed.SESSION_HOURS,
    fieldEncryptionKey,
    mongoUri: parsed.MONGO_URI,
    douyinCheckApiUrl: new URL(parsed.DOUYIN_CHECK_API_URL),
    douyinProfileApiUrl: new URL(parsed.DOUYIN_PROFILE_API_URL),
    qqOpProfileApiUrl: new URL(parsed.QQ_OP_PROFILE_API_URL),
    qqOpAppId: parsed.QQ_OP_APP_ID,
    qqOpProfileTimeoutMs: parsed.QQ_OP_PROFILE_TIMEOUT_MS,
    cookieSecure: parsed.COOKIE_SECURE
      ? parsed.COOKIE_SECURE === "true"
      : parsed.NODE_ENV === "production"
  };
}
