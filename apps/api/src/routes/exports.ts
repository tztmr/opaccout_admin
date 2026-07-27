import { Router } from "express";
import { AccountModel, type AccountRecord } from "../models/account";
import type { SecretCipher } from "../services/encryption";
import { exportAccounts } from "../services/exporter";
import type { AuditContext } from "../services/accounts";

export function createExportsRouter(cipher: SecretCipher, audit: { write(event: {
  action: string; targetType: string; targetIds: string[]; changedFields: string[];
  count: number; ip: string; userAgent: string; requestId: string;
}): Promise<void> }): Router {
  const router = Router();
  router.get("/accounts", async (req, res, next) => {
    try {
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const ids = typeof req.query.ids === "string" ? req.query.ids.split(",").filter(Boolean) : [];
      const filter = ids.length ? { _id: { $in: ids } } : {};
      const accounts = await AccountModel.find(filter).sort({ createdAt: -1 }).lean();
      const context: AuditContext = {
        ip: req.ip ?? "", userAgent: req.get("user-agent") ?? "",
        requestId: String(res.locals.requestId ?? "")
      };
      await audit.write({
        action: "account.exported", targetType: "account",
        targetIds: ids, changedFields: ["opSecret"], count: accounts.length, ...context
      });
      res.type(format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment(`douyin-accounts.${format}`).send(
        exportAccounts(accounts as Array<AccountRecord & { _id: unknown }>, cipher, format)
      );
    } catch (error) { next(error); }
  });
  return router;
}
