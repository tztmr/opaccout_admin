import express, { type ErrorRequestHandler, type Express } from "express";
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
import { createPublicOpRouter } from "./routes/public-op";
import type { PublicOpService } from "./services/public-op";

const TRUSTED_INTERNAL_PROXIES = ["loopback", "linklocal", "uniquelocal"];

const publicOpJsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: "请输入正确的 9 位短码" });
    return;
  }
  next(error);
};

type CreateAppOptions = {
  config: AppConfig;
  adminAuth: AdminAuthService;
  sessionStore?: Store;
  accountService?: AccountsService;
  cipher?: SecretCipher;
  publicOpService?: PublicOpService;
  audit?: Parameters<typeof createExportsRouter>[1];
  isReady?: () => boolean;
};

export function createApp({
  config,
  adminAuth,
  sessionStore,
  accountService,
  cipher,
  publicOpService,
  audit,
  isReady = () => true
}: CreateAppOptions): Express {
  const app = express();
  // The API is reachable only through the internal Nginx proxy chain; do not expose it directly.
  app.set("trust proxy", TRUSTED_INTERNAL_PROXIES);
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use("/api/op/resolve", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/op/resolve", publicOpJsonErrorHandler);
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
  if (publicOpService) app.use("/api/op", createPublicOpRouter(publicOpService));
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
