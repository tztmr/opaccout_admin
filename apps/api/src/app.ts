import express, { type Express } from "express";
import helmet from "helmet";
import session, { type Store } from "express-session";
import type { AppConfig } from "./config";
import { requireAdmin } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { requestIdMiddleware } from "./middleware/request-id";
import { createAuthRouter } from "./routes/auth";
import { createAccountsRouter } from "./routes/accounts";
import type { AccountsService } from "./services/accounts";
import type { AdminAuthService } from "./services/admin-auth";
import { createHealthRouter } from "./routes/health";
import { createAuditLogsRouter } from "./routes/audit-logs";
import { createSettingsRouter } from "./routes/settings";
import { createImportsRouter } from "./routes/imports";
import { createExportsRouter } from "./routes/exports";
import type { SecretCipher } from "./services/encryption";

type CreateAppOptions = {
  config: AppConfig;
  adminAuth: AdminAuthService;
  sessionStore?: Store;
  accountService?: AccountsService;
  cipher?: SecretCipher;
  audit?: Parameters<typeof createExportsRouter>[1];
  isReady?: () => boolean;
};

export function createApp({
  config,
  adminAuth,
  sessionStore,
  accountService,
  cipher,
  audit,
  isReady = () => true
}: CreateAppOptions): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      name: "douyin_admin_session",
      secret: config.sessionSecret,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        maxAge: config.sessionHours * 60 * 60 * 1000
      },
      resave: false,
      saveUninitialized: false
    })
  );

  app.use("/api/health", createHealthRouter(isReady));
  app.use("/api/auth", createAuthRouter(config, adminAuth));
  if (accountService) {
    app.use("/api/accounts", requireAdmin, createAccountsRouter(accountService));
  }
  if (cipher) app.use("/api/imports", requireAdmin, createImportsRouter(cipher));
  if (cipher && audit) app.use("/api/exports", requireAdmin, createExportsRouter(cipher, audit));
  app.use("/api/audit-logs", requireAdmin, createAuditLogsRouter());
  app.use("/api/settings", requireAdmin, createSettingsRouter(config));
  app.get("/api/test/protected", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
