import { Router } from "express";

export function createHealthRouter(isReady: () => boolean): Router {
  const router = Router();
  router.get("/live", (_req, res) => res.json({ status: "ok" }));
  router.get("/ready", (_req, res) => {
    if (!isReady()) {
      res.status(503).json({ status: "not_ready" });
      return;
    }
    res.json({ status: "ready" });
  });
  return router;
}
