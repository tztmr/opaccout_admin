import type { RequestHandler } from "express";
import { AppError } from "./errors";

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.session.admin) {
    next(new AppError(401, "AUTH_REQUIRED", "请先登录"));
    return;
  }

  next();
};
