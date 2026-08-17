import {
  AccountInputSchema,
  AccountListQuerySchema,
  type AccountDto,
  type AccountInput,
  type AccountListQuery,
  type AccountStats,
  type AccountStatus,
  DEFAULT_OP_PROJECT,
  DEFAULT_REGISTERED_REGION,
  type PagedResponse,
  type SaleStatus
} from "@douyin-admin/shared";
import { Types, type Model } from "mongoose";
import { AccountModel, type AccountRecord } from "../models/account";
import { AppError } from "../middleware/errors";
import type { SecretCipher } from "./encryption";
import type { DouyinCheckOptions, DouyinCheckResult } from "./douyin-check";
import { calculateOpExpiry } from "./op-expiry";
import type { OpProfileCheckResult } from "./op-profile";
import {
  applyOpProfileResult,
  resolveAccountStatus
} from "./op-profile-policy";
import { DouyinCheckError } from "./douyin-check";
import { normalizedDate } from "./import-parser";
import { createAccountWithShortOpRetry } from "./short-op-code";
import {
  assertBannedSaleStatusChange,
  resolveDetectedSaleStatus
} from "./sale-status-policy";

type AuditContext = {
  ip: string;
  userAgent: string;
  requestId: string;
};

type AuditService = {
  write(event: {
    action: string;
    targetType: string;
    targetIds: string[];
    changedFields: string[];
    count: number;
    ip: string;
    userAgent: string;
    requestId: string;
  }): Promise<void>;
};

type AccountServiceDependencies = {
  model?: Model<AccountRecord>;
  checkDouyinId(
    douyinId: string,
    options?: DouyinCheckOptions
  ): Promise<DouyinCheckResult>;
  checkOpProfile(opSecret: string): Promise<OpProfileCheckResult>;
  cipher: SecretCipher;
  audit: AuditService;
};

type AccountListResult = PagedResponse<AccountDto> & { stats: AccountStats };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordSearchRegex(keyword: string): RegExp | undefined {
  const terms = keyword
    .split(/\r?\n+/)
    .map((value) => value.trim().toLocaleLowerCase("zh-CN"))
    .filter(Boolean);
  if (!terms.length) return undefined;
  if (terms.length === 1) return new RegExp(escapeRegex(terms[0]!), "i");
  return new RegExp(terms.map((term) => escapeRegex(term)).join("|"), "i");
}

function extractBatchDouyinIds(keyword: string): string[] {
  const terms = keyword
    .split(/\r?\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (terms.length < 2) return [];
  if (!terms.every((term) => /^\d{1,32}$/.test(term))) return [];
  return [...new Set(terms)];
}

function toDto(
  value: AccountRecord & { _id: unknown },
  cipher: SecretCipher
): AccountDto {
  return {
    _id: String(value._id),
    douyinId: value.douyinId,
    secUid: value.secUid,
    registeredAt: value.registeredAt.toISOString(),
    opName: value.opName,
    hasOpSecret: true,
    accountPassword: value.accountPassword
      ? cipher.decrypt(value.accountPassword)
      : "",
    shortOpCode: value.shortOpCode!,
    opProject: value.opProject ?? DEFAULT_OP_PROJECT,
    opExpiresAt: value.opExpiresAt.toISOString(),
    owner: value.owner,
    registeredRegion: value.registeredRegion || DEFAULT_REGISTERED_REGION,
    saleStatus: value.saleStatus,
    accountStatus: value.accountStatus,
    accountCheckedAt: value.accountCheckedAt.toISOString(),
    remark: value.remark,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString()
  };
}

function duplicateError(error: unknown): AppError | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== 11000
  ) {
    return undefined;
  }
  const keyPattern =
    "keyPattern" in error && typeof error.keyPattern === "object"
      ? error.keyPattern
      : {};
  const field = keyPattern && "secUid" in keyPattern ? "secUid" : "douyinId";
  return new AppError(
    409,
    field === "secUid" ? "SEC_UID_DUPLICATE" : "DOUYIN_ID_DUPLICATE",
    field === "secUid" ? "sec_uid 已存在" : "抖音号已存在",
    { [field]: field === "secUid" ? "sec_uid 已存在" : "抖音号已存在" }
  );
}


async function detectDouyinStatus(
  checkDouyinId: AccountServiceDependencies["checkDouyinId"],
  douyinId: string,
  options: DouyinCheckOptions = {}
) {
  try {
    const secUid = options.secUid?.trim();
    if (secUid) {
      return await checkDouyinId(douyinId, { ...options, secUid });
    }
    return await checkDouyinId(douyinId);
  } catch (error) {
    if (error instanceof DouyinCheckError) {
      return {
        secUid: options.secUid?.trim() || "",
        accountStatus: "unknown" as const,
        checkedAt: new Date()
      };
    }
    throw error;
  }
}

export function createAccountsService({
  model = AccountModel,
  checkDouyinId,
  checkOpProfile,
  cipher,
  audit
}: AccountServiceDependencies) {
  async function writeAudit(
    action: string,
    targetIds: string[],
    changedFields: string[],
    context: AuditContext
  ) {
    await audit.write({
      action,
      targetType: "account",
      targetIds,
      changedFields,
      count: targetIds.length,
      ...context
    });
  }

  return {
    async check(douyinId: string) {
      if (!/^\d{1,32}$/.test(douyinId)) {
        throw new AppError(400, "DOUYIN_ID_INVALID", "抖音号格式不正确");
      }
      return checkDouyinId(douyinId);
    },

    async create(rawInput: unknown, context: AuditContext): Promise<AccountDto> {
      const input = AccountInputSchema.parse(rawInput);
      const [detected, opResult] = await Promise.all([
        detectDouyinStatus(checkDouyinId, input.douyinId),
        checkOpProfile(input.opSecret)
      ]);
      const prepared = applyOpProfileResult(input, opResult);
      const { accountPassword, ...preparedFields } = prepared;
      const accountStatus = resolveAccountStatus(detected.accountStatus, opResult);
      try {
        const created = await createAccountWithShortOpRetry(model, {
          ...preparedFields,
          registeredAt: new Date(`${prepared.registeredAt}T00:00:00.000Z`),
          secUid: detected.secUid,
          accountStatus,
          accountCheckedAt: detected.checkedAt,
          saleStatus: resolveDetectedSaleStatus(
            accountStatus,
            prepared.saleStatus
          ),
          opSecret: cipher.encrypt(prepared.opSecret),
          opExpiresAt: calculateOpExpiry(prepared.opSecret),
          accountPassword: accountPassword
            ? cipher.encrypt(accountPassword)
            : undefined
        });
        await writeAudit(
          "account.created",
          [String(created._id)],
          Object.keys(input),
          context
        );
        return toDto(created, cipher);
      } catch (error) {
        throw duplicateError(error) ?? error;
      }
    },

    async get(id: string): Promise<AccountDto> {
      if (!Types.ObjectId.isValid(id)) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const account = await model.findById(id).lean();
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      return toDto(account as AccountRecord & { _id: unknown }, cipher);
    },

    async list(rawQuery: unknown): Promise<AccountListResult> {
      const query = AccountListQuerySchema.parse(rawQuery);
      const filter: Record<string, unknown> = {};
      const requestedDouyinIds = query.keyword
        ? extractBatchDouyinIds(query.keyword)
        : [];
      const keywordRegex = query.keyword
        ? buildKeywordSearchRegex(query.keyword)
        : undefined;
      if (keywordRegex) filter.searchText = keywordRegex;
      if (query.saleStatus) filter.saleStatus = query.saleStatus;
      if (query.accountStatus) filter.accountStatus = query.accountStatus;
      if (query.owner) filter.owner = query.owner;
      if (query.registeredFrom || query.registeredTo) {
        filter.registeredAt = {
          ...(query.registeredFrom ? { $gte: new Date(`${query.registeredFrom}T00:00:00.000Z`) } : {}),
          ...(query.registeredTo ? { $lte: new Date(`${query.registeredTo}T23:59:59.999Z`) } : {})
        };
      }
      const pageSize = query.pageSize;
      const isAllPageSize = pageSize === "all";
      const resolvedPageSize: 20 | 50 | 100 | null = isAllPageSize
        ? null
        : pageSize;
      const page = isAllPageSize ? 1 : query.page;
      const skip = resolvedPageSize == null ? 0 : (page - 1) * resolvedPageSize;
      const sortValue = query.sortDirection === "desc" ? -1 : 1;
      let findQuery = model
        .find(filter)
        .sort({ registeredAt: sortValue, _id: sortValue })
        .skip(skip);
      if (resolvedPageSize != null) {
        findQuery = findQuery.limit(resolvedPageSize);
      }
      const matchedDouyinIdsPromise: Promise<string[]> = requestedDouyinIds.length
        ? model
            .distinct("douyinId", {
              ...(filter.registeredAt ? { registeredAt: filter.registeredAt } : {}),
              ...(filter.saleStatus ? { saleStatus: filter.saleStatus } : {}),
              ...(filter.accountStatus ? { accountStatus: filter.accountStatus } : {}),
              ...(filter.owner ? { owner: filter.owner } : {}),
              douyinId: { $in: requestedDouyinIds }
            })
            .then((values) => values as string[])
        : Promise.resolve([]);
      const [items, total, statusCounts, matchedDouyinIds] = await Promise.all([
        findQuery.lean(),
        model.countDocuments(filter),
        model.aggregate<{ _id: string; count: number }>([
          { $group: { _id: "$saleStatus", count: { $sum: 1 } } }
        ]),
        matchedDouyinIdsPromise
      ]);
      const statusMap = Object.fromEntries(statusCounts.map((item) => [item._id, item.count]));
      const abnormal = await model.countDocuments({ accountStatus: { $in: ["violation", "banned", "op_invalid"] } });
      const responsePageSize: 20 | 50 | 100 | "all" =
        resolvedPageSize == null ? "all" : resolvedPageSize;
      const totalPages =
        resolvedPageSize == null
          ? 1
          : Math.max(1, Math.ceil(total / resolvedPageSize));
      return {
        items: items.map((item) => toDto(item as AccountRecord & { _id: unknown }, cipher)),
        page,
        pageSize: responsePageSize,
        total,
        totalPages,
        ...(requestedDouyinIds.length
          ? {
              searchSummary: {
                requested: requestedDouyinIds.length,
                found: matchedDouyinIds.length,
                missingKeywords: requestedDouyinIds.filter(
                  (douyinId) => !matchedDouyinIds.includes(douyinId)
                )
              }
            }
          : {}),
        stats: {
          total: Object.values(statusMap).reduce((sum, count) => sum + count, 0),
          unsold: statusMap.unsold ?? 0,
          sold: statusMap.sold ?? 0,
          abnormal
        }
      };
    },

    async owners(): Promise<{ items: string[] }> {
      const values = await model.distinct("owner", { owner: { $ne: "" } });
      return {
        items: [...new Set(values.map((value) => value.trim()).filter(Boolean))]
          .sort((left, right) => left.localeCompare(right, "zh-CN"))
      };
    },

    async update(id: string, rawPatch: unknown, context: AuditContext): Promise<AccountDto> {
      const patch = AccountInputSchema.partial().strict().parse(rawPatch);
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const changedFields = Object.keys(patch);
      assertBannedSaleStatusChange(account.accountStatus, patch.saleStatus);

      if ("accountPassword" in patch) {
        account.accountPassword = patch.accountPassword
          ? cipher.encrypt(patch.accountPassword)
          : undefined;
      }

      if (patch.douyinId && patch.douyinId !== account.douyinId) {
        const detected = await detectDouyinStatus(checkDouyinId, patch.douyinId);
        account.secUid = detected.secUid;
        account.accountStatus = detected.accountStatus;
        account.accountCheckedAt = detected.checkedAt;
        changedFields.push("secUid", "accountStatus", "accountCheckedAt");
        if (detected.accountStatus === "banned") {
          patch.saleStatus = "disabled";
          if (!changedFields.includes("saleStatus")) changedFields.push("saleStatus");
        }
      }
      if (patch.opSecret) {
        account.opSecret = cipher.encrypt(patch.opSecret);
        account.opExpiresAt = calculateOpExpiry(patch.opSecret);
        changedFields.push("opExpiresAt");
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key === "opSecret" || key === "accountPassword") continue;
        if (key === "registeredAt") {
          account.registeredAt = new Date(`${value}T00:00:00.000Z`);
        } else {
          (account as unknown as Record<string, unknown>)[key] = value;
        }
      }
      try {
        await account.save();
      } catch (error) {
        throw duplicateError(error) ?? error;
      }
      await writeAudit("account.updated", [id], changedFields, context);
      return toDto(account, cipher);
    },

    async reveal(id: string, context: AuditContext): Promise<{ opSecret: string }> {
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      await writeAudit("account.secret_revealed", [id], ["opSecret"], context);
      return { opSecret: cipher.decrypt(account.opSecret) };
    },

    async recheckOp(id: string, context: AuditContext): Promise<AccountDto> {
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      if (account.accountStatus === "banned") {
        throw new AppError(409, "BANNED_ACCOUNT", "封禁账号无需重新检测 OP");
      }

      const opSecret = cipher.decrypt(account.opSecret);
      const opResult = await checkOpProfile(opSecret);
      const prepared = applyOpProfileResult({
        douyinId: account.douyinId,
        registeredAt: account.registeredAt.toISOString().slice(0, 10),
        opName: account.opName,
        opSecret,
        opProject: account.opProject ?? DEFAULT_OP_PROJECT,
        owner: account.owner,
        registeredRegion: account.registeredRegion,
        saleStatus: account.saleStatus,
        remark: account.remark
      }, opResult);

      let baseAccountStatus: AccountStatus = account.accountStatus;
      const changedFields = new Set(["opName", "remark", "saleStatus", "accountStatus"]);

      // OP检测成功后，若此前因 token 失效被标记为 op_invalid，需要恢复真实抖音状态。
      if (account.accountStatus === "op_invalid" && opResult.kind !== "message") {
        const detected = await detectDouyinStatus(checkDouyinId, account.douyinId, {
          secUid: account.secUid
        });
        account.secUid = detected.secUid || account.secUid;
        account.accountCheckedAt = detected.checkedAt;
        baseAccountStatus = detected.accountStatus;
        changedFields.add("secUid");
        changedFields.add("accountCheckedAt");
      }

      account.opName = prepared.opName;
      account.remark = prepared.remark;
      account.accountStatus = resolveAccountStatus(baseAccountStatus, opResult);
      account.saleStatus = resolveDetectedSaleStatus(
        account.accountStatus,
        prepared.saleStatus
      );

      await account.save();
      await writeAudit(
        "account.op_rechecked",
        [id],
        [...changedFields],
        context
      );
      return toDto(account, cipher);
    },

    async remove(id: string, context: AuditContext): Promise<void> {
      const deleted = await model.findByIdAndDelete(id);
      if (!deleted) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      await writeAudit("account.deleted", [id], [], context);
    },

    async batchRemove(ids: string[], context: AuditContext) {
      if (!ids.length || ids.length > 500) {
        throw new AppError(400, "BATCH_IDS_INVALID", "请选择 1 至 500 条数据");
      }
      const result = await model.deleteMany({ _id: { $in: ids } });
      await writeAudit("account.batch_deleted", ids, [], context);
      return { deleted: result.deletedCount };
    },

    async batchUpdate(
      ids: string[],
      patch: {
        saleStatus?: SaleStatus;
        accountStatus?: AccountStatus;
        owner?: string;
        registeredRegion?: string;
        remark?: string;
      },
      context: AuditContext
    ) {
      if (!ids.length || ids.length > 500) throw new AppError(400, "BATCH_IDS_INVALID", "请选择 1 至 500 条数据");
      const allowedPatch: Record<string, unknown> = {};
      if (patch.saleStatus) allowedPatch.saleStatus = patch.saleStatus;
      if (patch.accountStatus) {
        allowedPatch.accountStatus = patch.accountStatus;
        allowedPatch.accountCheckedAt = new Date();
        if (patch.accountStatus === "banned") {
          // Keep banned accounts locked to 已停用 even if a saleStatus was also sent.
          allowedPatch.saleStatus = "disabled";
        }
      }
      if (patch.owner?.trim()) allowedPatch.owner = patch.owner.trim();
      if (patch.registeredRegion?.trim()) {
        allowedPatch.registeredRegion = patch.registeredRegion.trim();
      }
      if ("remark" in patch) {
        allowedPatch.remark = patch.remark?.trim() ?? "";
      }
      if (!Object.keys(allowedPatch).length) throw new AppError(400, "BATCH_PATCH_EMPTY", "没有可修改的字段");
      const effectiveSaleStatus =
        (allowedPatch.saleStatus as SaleStatus | undefined) ?? patch.saleStatus;
      if (effectiveSaleStatus && effectiveSaleStatus !== "disabled") {
        // If we are not changing accountStatus away from banned, keep the lock.
        const remainingBanned = patch.accountStatus && patch.accountStatus !== "banned"
          ? 0
          : await model.countDocuments({
              _id: { $in: ids },
              accountStatus: "banned"
            });
        if (remainingBanned > 0) {
          throw new AppError(
            409,
            "BANNED_ACCOUNT_SALE_STATUS_LOCKED",
            `${remainingBanned} 个封禁账号的售卖状态必须保持为已停用`
          );
        }
      }
      const result = await model.updateMany({ _id: { $in: ids } }, { $set: allowedPatch });
      await writeAudit("account.batch_updated", ids, Object.keys(allowedPatch), context);
      return { updated: result.modifiedCount };
    },

    async recheck(id: string, context: AuditContext): Promise<AccountDto> {
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const detected = await detectDouyinStatus(checkDouyinId, account.douyinId, {
        secUid: account.secUid
      });
      account.secUid = detected.secUid || account.secUid;
      // recheck only refreshes Douyin-derived status; keep OP失效 until OP is revalidated on create/import
      if (account.accountStatus !== "op_invalid") {
        account.accountStatus = detected.accountStatus;
      }
      account.accountCheckedAt = detected.checkedAt;
      account.saleStatus = resolveDetectedSaleStatus(
        account.accountStatus,
        account.saleStatus
      );
      await account.save();
      await writeAudit(
        "account.rechecked",
        [id],
        ["secUid", "accountStatus", "accountCheckedAt", "saleStatus"],
        context
      );
      return toDto(account, cipher);
    },

    async batchRecheck(ids: string[], context: AuditContext) {
      if (!ids.length || ids.length > 500) {
        throw new AppError(400, "BATCH_IDS_INVALID", "请选择 1 至 500 条数据");
      }
      const succeeded: AccountDto[] = [];
      const failed: Array<{ id: string; code: string }> = [];
      for (let index = 0; index < ids.length; index += 5) {
        const chunk = ids.slice(index, index + 5);
        const results = await Promise.allSettled(chunk.map((id) => this.recheck(id, context)));
        results.forEach((result, resultIndex) => {
          const id = chunk[resultIndex] ?? "";
          if (result.status === "fulfilled") succeeded.push(result.value);
          else failed.push({
            id,
            code: result.reason instanceof Error ? result.reason.message : "RECHECK_FAILED"
          });
        });
      }
      return { succeeded, failed };
    },

    async batchRecheckOp(ids: string[], context: AuditContext) {
      if (!ids.length || ids.length > 500) {
        throw new AppError(400, "BATCH_IDS_INVALID", "请选择 1 至 500 条数据");
      }
      const succeeded: AccountDto[] = [];
      const failed: Array<{ id: string; code: string }> = [];
      const skipped: Array<{ id: string; code: string }> = [];
      for (let index = 0; index < ids.length; index += 5) {
        const chunk = ids.slice(index, index + 5);
        const results = await Promise.allSettled(
          chunk.map((id) => this.recheckOp(id, context))
        );
        results.forEach((result, resultIndex) => {
          const id = chunk[resultIndex] ?? "";
          if (result.status === "fulfilled") {
            succeeded.push(result.value);
          } else if (result.reason instanceof AppError && result.reason.code === "BANNED_ACCOUNT") {
            skipped.push({ id, code: result.reason.code });
          } else {
            failed.push({
              id,
              code: result.reason instanceof Error ? result.reason.message : "RECHECK_OP_FAILED"
            });
          }
        });
      }
      return { succeeded, failed, skipped };
    },

    async batchOverrideDates(items: { douyinId: string; registeredAt: string }[], context: AuditContext) {
      if (!items.length || items.length > 2000) {
        throw new AppError(400, "BATCH_ITEMS_INVALID", "一次最多支持覆盖 2000 条");
      }
      const validItems = items.map(item => ({
        douyinId: item.douyinId,
        registeredAt: normalizedDate(item.registeredAt)
      })).filter(item => item.registeredAt !== "");

      if (!validItems.length) return { matched: 0, updated: 0 };

      const bulkOps = validItems.map(item => ({
        updateOne: {
          filter: { douyinId: item.douyinId },
          update: { $set: { registeredAt: new Date(`${item.registeredAt}T00:00:00.000Z`) } }
        }
      }));

      const douyinIds = validItems.map(i => i.douyinId);
      const matched = await model.find({ douyinId: { $in: douyinIds } }).select('_id douyinId').lean();
      
      const result = await model.bulkWrite(bulkOps);
      
      if (matched.length) {
        await writeAudit("account.batch_override_dates", matched.map(m => String(m._id)), ["registeredAt"], context);
      }
      return { matched: matched.length, updated: result.modifiedCount };
    }
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
export type { AccountInput, AccountListQuery, AuditContext };
