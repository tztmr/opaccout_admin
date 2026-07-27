import type { Request, Router } from "express";
import { Router as createRouter } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../config";
import { AppError } from "../middleware/errors";
import {
  AdminAlreadyExistsError,
  type AdminAuthService
} from "../services/admin-auth";

const CredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(12).max(4096)
  })
  .strict();

function createCredentialLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const username =
        typeof req.body === "object" &&
        req.body !== null &&
        "username" in req.body &&
        typeof req.body.username === "string"
          ? req.body.username.trim().toLocaleLowerCase("zh-CN")
          : "";
      return `${ipKeyGenerator(req.ip ?? "unknown")}:${username}`;
    }
  });
}

async function establishAdminSession(
  req: Request,
  username: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.admin = {
    username,
    authenticatedAt: new Date().toISOString()
  };
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export function createAuthRouter(
  _config: AppConfig,
  adminAuth: AdminAuthService
): Router {
  const router = createRouter();
  const setupLimiter = createCredentialLimiter();
  const loginLimiter = createCredentialLimiter();

  router.get("/setup", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ needsSetup: await adminAuth.needsSetup() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/setup", setupLimiter, async (req, res, next) => {
    try {
      const credentials = CredentialsSchema.parse(req.body);
      const admin = await adminAuth.setup(credentials);
      await establishAdminSession(req, admin.username);
      res.status(201).json({ authenticated: true, username: admin.username });
    } catch (error) {
      if (error instanceof AdminAlreadyExistsError) {
        next(
          new AppError(409, "ADMIN_ALREADY_EXISTS", "管理员已存在，请直接登录")
        );
        return;
      }
      next(error);
    }
  });

  router.post("/login", loginLimiter, async (req, res, next) => {
    try {
      const credentials = CredentialsSchema.parse(req.body);
      if (await adminAuth.needsSetup()) {
        throw new AppError(409, "SETUP_REQUIRED", "请先注册管理员");
      }

      const admin = await adminAuth.authenticate(credentials);
      if (!admin) {
        throw new AppError(
          401,
          "AUTH_INVALID_CREDENTIALS",
          "用户名或密码错误"
        );
      }

      await establishAdminSession(req, admin.username);
      res.json({ authenticated: true, username: admin.username });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      res.clearCookie("douyin_admin_session");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", (req, res, next) => {
    if (!req.session.admin) {
      next(new AppError(401, "AUTH_REQUIRED", "请先登录"));
      return;
    }

    res.json({
      authenticated: true,
      username: req.session.admin.username
    });
  });

  return router;
}
