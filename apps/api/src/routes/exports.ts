import { Router } from "express";
import { AccountListQuerySchema } from "@douyin-admin/shared";
import { AccountModel, type AccountRecord } from "../models/account";
import type { SecretCipher } from "../services/encryption";
import { exportAccounts } from "../services/exporter";
import type { AuditContext } from "../services/accounts";

function queryString(
  query: Record<string, unknown>,
  key: string
): string | undefined {
  return typeof query[key] === "string" ? query[key] : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keyword: string): RegExp | undefined {
  const terms = keyword
    .split(/\r?\n+/)
    .map((value) => value.trim().toLocaleLowerCase("zh-CN"))
    .filter(Boolean);
  if (!terms.length) return undefined;
  if (terms.length === 1) return new RegExp(escapeRegex(terms[0]!), "i");
  return new RegExp(terms.map((term) => escapeRegex(term)).join("|"), "i");
}

export function buildExportFilter(query: unknown): Record<string, unknown> {
  const source =
    typeof query === "object" && query !== null
      ? query as Record<string, unknown>
      : {};
  const listQuery = AccountListQuerySchema.partial().parse({
    ...(queryString(source, "keyword") ? { keyword: queryString(source, "keyword") } : {}),
    ...(queryString(source, "saleStatus") ? { saleStatus: queryString(source, "saleStatus") } : {}),
    ...(queryString(source, "accountStatus") ? { accountStatus: queryString(source, "accountStatus") } : {}),
    ...(queryString(source, "owner") ? { owner: queryString(source, "owner") } : {}),
    ...(queryString(source, "registeredFrom") ? { registeredFrom: queryString(source, "registeredFrom") } : {}),
    ...(queryString(source, "registeredTo") ? { registeredTo: queryString(source, "registeredTo") } : {})
  });
  const filter: Record<string, unknown> = {};
  if (listQuery.keyword) {
    const regex = buildKeywordRegex(listQuery.keyword);
    if (regex) filter.searchText = regex;
  }
  if (listQuery.saleStatus) filter.saleStatus = listQuery.saleStatus;
  if (listQuery.accountStatus) filter.accountStatus = listQuery.accountStatus;
  if (listQuery.owner) filter.owner = listQuery.owner;
  if (listQuery.registeredFrom || listQuery.registeredTo) {
    filter.registeredAt = {
      ...(listQuery.registeredFrom
        ? { $gte: new Date(`${listQuery.registeredFrom}T00:00:00.000Z`) }
        : {}),
      ...(listQuery.registeredTo
        ? { $lte: new Date(`${listQuery.registeredTo}T23:59:59.999Z`) }
        : {})
    };
  }
  return filter;
}

export function createExportsRouter(cipher: SecretCipher, audit: { write(event: {
  action: string; targetType: string; targetIds: string[]; changedFields: string[];
  count: number; ip: string; userAgent: string; requestId: string;
}): Promise<void> }): Router {
  const router = Router();
  router.get("/accounts", async (req, res, next) => {
    try {
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const ids = typeof req.query.ids === "string" ? req.query.ids.split(",").filter(Boolean) : [];
      const sortDirection = req.query.sortDirection === "desc" ? -1 : 1;
      const filter: Record<string, unknown> = ids.length
        ? { _id: { $in: ids } }
        : buildExportFilter(req.query);
      const accounts = await AccountModel.find(filter)
        .sort({ registeredAt: sortDirection, _id: sortDirection })
        .lean();
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
