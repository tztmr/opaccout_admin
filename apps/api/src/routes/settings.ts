import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config";
import { SettingModel } from "../models/setting";

const SettingsSchema = z.object({
  defaultPageSize: z.number().int().min(10).max(100),
  sessionHours: z.number().int().min(1).max(168),
  qqOpSocksProxyPool: z.string().max(50_000)
}).strict();

export function createSettingsRouter(config: Pick<AppConfig, "qqOpSocksProxyUrls">): Router {
  const router = Router();
  router.get("/", async (_req, res, next) => {
    try {
      const settings = await SettingModel.findOneAndUpdate(
        { key: "admin" },
        {
          $setOnInsert: {
            defaultPageSize: 20,
            sessionHours: 12,
            qqOpSocksProxyPool: config.qqOpSocksProxyUrls
              .map((item) => item.href)
              .join("\n")
          }
        },
        { new: true, upsert: true }
      ).lean();
      res.json(settings);
    } catch (error) { next(error); }
  });
  router.patch("/", async (req, res, next) => {
    try {
      const value = SettingsSchema.parse(req.body);
      const settings = await SettingModel.findOneAndUpdate(
        { key: "admin" },
        { $set: value },
        { new: true, upsert: true }
      ).lean();
      res.json(settings);
    } catch (error) { next(error); }
  });
  return router;
}
