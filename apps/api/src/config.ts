import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ADMIN_USERNAME: z.string().trim().min(1).max(100),
  ADMIN_PASSWORD: z.string().min(12).max(4096),
  SESSION_SECRET: z.string().min(32),
  SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  MONGO_URI: z.string().min(1),
  DOUYIN_CHECK_API_URL: z.url().refine((value) => new URL(value).protocol === "https:", {
    message: "DOUYIN_CHECK_API_URL must use HTTPS"
  })
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  adminUsername: string;
  adminPassword: string;
  sessionSecret: string;
  sessionHours: number;
  fieldEncryptionKey: Buffer;
  mongoUri: string;
  douyinCheckApiUrl: URL;
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
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    sessionSecret: parsed.SESSION_SECRET,
    sessionHours: parsed.SESSION_HOURS,
    fieldEncryptionKey,
    mongoUri: parsed.MONGO_URI,
    douyinCheckApiUrl: new URL(parsed.DOUYIN_CHECK_API_URL),
    cookieSecure: parsed.COOKIE_SECURE
      ? parsed.COOKIE_SECURE === "true"
      : parsed.NODE_ENV === "production"
  };
}
