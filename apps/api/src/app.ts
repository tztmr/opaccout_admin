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

type CreateAppOptions = {
  config: AppConfig;
  sessionStore?: Store;
  accountService?: AccountsService;
};

export function createApp({ config, sessionStore, accountService }: CreateAppOptions): Express {
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

  app.use("/api/auth", createAuthRouter(config));
  if (accountService) {
    app.use("/api/accounts", requireAdmin, createAccountsRouter(accountService));
  }
  app.get("/api/test/protected", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
