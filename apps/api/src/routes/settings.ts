import { Router } from "express";
import { z } from "zod";
import { SettingModel } from "../models/setting";

const SettingsSchema = z.object({
  defaultPageSize: z.number().int().min(10).max(100),
  sessionHours: z.number().int().min(1).max(168)
}).strict();

function publicSettings(settings: {
  defaultPageSize: number;
  sessionHours: number;
  updatedAt?: Date;
}) {
  return {
    defaultPageSize: settings.defaultPageSize,
    sessionHours: settings.sessionHours,
    updatedAt: settings.updatedAt
  };
}

export function createSettingsRouter(): Router {
  const router = Router();
  router.get("/", async (_req, res, next) => {
    try {
      const settings = await SettingModel.findOneAndUpdate(
        { key: "admin" },
        {
          $setOnInsert: {
            defaultPageSize: 20,
            sessionHours: 12
          }
        },
        { new: true, upsert: true }
      ).lean();
      res.json(publicSettings(settings));
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
      res.json(publicSettings(settings));
    } catch (error) { next(error); }
  });
  return router;
}
