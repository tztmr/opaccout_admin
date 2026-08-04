import { PublicOpResolveRequestSchema } from "@douyin-admin/shared";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { PublicOpService } from "../services/public-op";

const INVALID_CODE_MESSAGE = "请输入正确的 9 位短码";
const NOT_FOUND_MESSAGE = "短 OP 无效或已过期";

function noStore(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader("Cache-Control", "no-store");
}

function createPublicOpLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      noStore(res);
      res.status(429).json({ error: "请求过于频繁" });
    }
  });
}

export function createPublicOpRouter(service: PublicOpService): Router {
  const router = Router();

  router.post("/resolve", createPublicOpLimiter(), async (req, res, next) => {
    noStore(res);
    const parsed = PublicOpResolveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: INVALID_CODE_MESSAGE });
      return;
    }

    try {
      const resolved = await service.resolve(parsed.data.code);
      if (!resolved) {
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      }
      res.json(resolved);
    } catch (error) {
      noStore(res);
      next(error);
    }
  });

  return router;
}
