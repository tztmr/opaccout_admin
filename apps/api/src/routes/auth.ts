import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../config";
import { AppError } from "../middleware/errors";

const LoginSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(4096)
  })
  .strict();

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const paddedLength = Math.max(actualBuffer.length, expectedBuffer.length, 1);
  const actualPadded = Buffer.alloc(paddedLength);
  const expectedPadded = Buffer.alloc(paddedLength);
  actualBuffer.copy(actualPadded);
  expectedBuffer.copy(expectedPadded);

  return (
    timingSafeEqual(actualPadded, expectedPadded) &&
    actualBuffer.length === expectedBuffer.length
  );
}

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const limiter = rateLimit({
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

  router.post("/login", limiter, async (req, res, next) => {
    try {
      const credentials = LoginSchema.parse(req.body);
      const validUsername = constantTimeEqual(
        credentials.username,
        config.adminUsername
      );
      const validPassword = constantTimeEqual(
        credentials.password,
        config.adminPassword
      );
      const valid = validUsername && validPassword;

      if (!valid) {
        throw new AppError(
          401,
          "AUTH_INVALID_CREDENTIALS",
          "用户名或密码错误"
        );
      }

      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      req.session.admin = {
        username: config.adminUsername,
        authenticatedAt: new Date().toISOString()
      };
      await new Promise<void>((resolve, reject) => {
        req.session.save((error) => (error ? reject(error) : resolve()));
      });

      res.json({ authenticated: true, username: config.adminUsername });
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
