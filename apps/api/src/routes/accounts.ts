import { ACCOUNT_STATUSES, SALE_STATUSES } from "@douyin-admin/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { AccountsService, AuditContext } from "../services/accounts";

function context(req: Request): AuditContext {
  return {
    ip: req.ip ?? "",
    userAgent: req.get("user-agent") ?? "",
    requestId: String(req.res?.locals.requestId ?? "")
  };
}

const BatchUpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  saleStatus: z.enum(SALE_STATUSES).optional(),
  owner: z.string().trim().min(1).max(100).optional()
}).strict();
const BatchIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(500)
}).strict();

export function createAccountsRouter(service: AccountsService): Router {
  const router = Router();
  router.get("/", async (req, res, next) => {
    try { res.json(await service.list(req.query)); } catch (error) { next(error); }
  });
  router.post("/query", async (req, res, next) => {
    try { res.json(await service.list(req.body)); } catch (error) { next(error); }
  });
  router.get("/owners", async (_req, res, next) => {
    try { res.json(await service.owners()); } catch (error) { next(error); }
  });
  router.post("/check-douyin", async (req, res, next) => {
    try { res.json(await service.check(String(req.body?.douyinId ?? ""))); } catch (error) { next(error); }
  });
  router.post("/", async (req, res, next) => {
    try { res.status(201).json(await service.create(req.body, context(req))); } catch (error) { next(error); }
  });
  router.post("/batch-update", async (req, res, next) => {
    try {
      const value = BatchUpdateSchema.parse(req.body);
      res.json(await service.batchUpdate(value.ids, {
        ...(value.saleStatus ? { saleStatus: value.saleStatus } : {}),
        ...(value.owner ? { owner: value.owner } : {})
      }, context(req)));
    } catch (error) { next(error); }
  });
  router.post("/batch-delete", async (req, res, next) => {
    try {
      const value = BatchIdsSchema.parse(req.body);
      res.json(await service.batchRemove(value.ids, context(req)));
    } catch (error) { next(error); }
  });
  router.post("/batch-recheck", async (req, res, next) => {
    try {
      const value = BatchIdsSchema.parse(req.body);
      res.json(await service.batchRecheck(value.ids, context(req)));
    } catch (error) { next(error); }
  });
  router.post("/batch-recheck-op", async (req, res, next) => {
    try {
      const value = BatchIdsSchema.parse(req.body);
      res.json(await service.batchRecheckOp(value.ids, context(req)));
    } catch (error) { next(error); }
  });
  router.get("/:id", async (req, res, next) => {
    try { res.json(await service.get(String(req.params.id))); } catch (error) { next(error); }
  });
  router.patch("/:id", async (req, res, next) => {
    try { res.json(await service.update(String(req.params.id), req.body, context(req))); } catch (error) { next(error); }
  });
  router.delete("/:id", async (req, res, next) => {
    try { await service.remove(String(req.params.id), context(req)); res.status(204).end(); } catch (error) { next(error); }
  });
  router.post("/:id/reveal-secret", async (req, res, next) => {
    try { res.json(await service.reveal(String(req.params.id), context(req))); } catch (error) { next(error); }
  });
  router.post("/:id/recheck", async (req, res, next) => {
    try { res.json(await service.recheck(String(req.params.id), context(req))); } catch (error) { next(error); }
  });
  router.post("/:id/recheck-op", async (req, res, next) => {
    try { res.json(await service.recheckOp(String(req.params.id), context(req))); } catch (error) { next(error); }
  });
  return router;
}
