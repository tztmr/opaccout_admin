import { Router } from "express";
import { z } from "zod";
import { AccountKindSchema } from "@douyin-admin/shared";
import { SettingModel } from "../models/setting";
import {
  getAccountColumnOrders,
  saveAccountColumnOrder
} from "../services/account-column-settings";

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
  router.get("/account-columns", async (_req, res, next) => {
    try {
      res.json(await getAccountColumnOrders());
    } catch (error) { next(error); }
  });
  router.patch("/account-columns/:accountKind", async (req, res, next) => {
    try {
      const accountKind = AccountKindSchema.parse(req.params.accountKind);
      const body = z.object({ order: z.array(z.string()) }).strict().parse(req.body);
      res.json({
        accountKind,
        order: await saveAccountColumnOrder(accountKind, body.order)
      });
    } catch (error) { next(error); }
  });
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
