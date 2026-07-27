import { Router } from "express";
import { z } from "zod";
import { AuditLogModel } from "../models/audit-log";

export function createAuditLogsRouter(): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try {
      const query = z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        action: z.string().trim().max(100).optional()
      }).parse(req.query);
      const filter = query.action ? { action: query.action } : {};
      const [items, total] = await Promise.all([
        AuditLogModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
        AuditLogModel.countDocuments(filter)
      ]);
      res.json({ items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) });
    } catch (error) { next(error); }
  });
  return router;
}
