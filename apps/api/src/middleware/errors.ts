import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "请求的接口不存在"));
};

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  let normalized: AppError;

  if (error instanceof AppError) {
    normalized = error;
  } else if (error instanceof z.ZodError) {
    normalized = new AppError(
      400,
      "VALIDATION_FAILED",
      "提交的数据不符合要求",
      zodFieldErrors(error)
    );
  } else if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    normalized = new AppError(413, "REQUEST_BODY_TOO_LARGE", "请求内容过大");
  } else {
    normalized = new AppError(500, "INTERNAL_ERROR", "服务器内部错误");
  }

  const body: {
    error: {
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
    };
    requestId: string;
  } = {
    error: {
      code: normalized.code,
      message: normalized.message
    },
    requestId: String(res.locals.requestId ?? "")
  };

  if (normalized.fieldErrors) body.error.fieldErrors = normalized.fieldErrors;
  res.status(normalized.status).json(body);
};
