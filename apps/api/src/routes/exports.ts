import { Router } from "express";
import { AccountListQuerySchema } from "@douyin-admin/shared";
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
      const listQuery = AccountListQuerySchema.partial().parse({
        ...(typeof req.query.keyword === "string" ? { keyword: req.query.keyword } : {}),
        ...(typeof req.query.saleStatus === "string" ? { saleStatus: req.query.saleStatus } : {}),
        ...(typeof req.query.accountStatus === "string" ? { accountStatus: req.query.accountStatus } : {}),
        ...(typeof req.query.registeredFrom === "string" ? { registeredFrom: req.query.registeredFrom } : {}),
        ...(typeof req.query.registeredTo === "string" ? { registeredTo: req.query.registeredTo } : {})
      });
      const filter: Record<string, unknown> = ids.length ? { _id: { $in: ids } } : {};
      if (!ids.length) {
        if (listQuery.keyword) {
          const escaped = listQuery.keyword.toLocaleLowerCase("zh-CN").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          filter.searchText = new RegExp(escaped, "i");
        }
        if (listQuery.saleStatus) filter.saleStatus = listQuery.saleStatus;
        if (listQuery.accountStatus) filter.accountStatus = listQuery.accountStatus;
        if (listQuery.registeredFrom || listQuery.registeredTo) {
          filter.registeredAt = {
            ...(listQuery.registeredFrom ? { $gte: new Date(`${listQuery.registeredFrom}T00:00:00.000Z`) } : {}),
            ...(listQuery.registeredTo ? { $lte: new Date(`${listQuery.registeredTo}T23:59:59.999Z`) } : {})
          };
        }
      }
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
