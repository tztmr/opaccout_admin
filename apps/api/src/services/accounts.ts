import {
  AccountInputSchema,
  AccountListQuerySchema,
  type AccountDto,
  type AccountInput,
  type AccountListQuery,
  type AccountStats,
  type PagedResponse,
  type SaleStatus
} from "@douyin-admin/shared";
import { Types, type Model } from "mongoose";
import { AccountModel, type AccountRecord } from "../models/account";
import { AppError } from "../middleware/errors";
import type { SecretCipher } from "./encryption";
import type { DouyinCheckResult } from "./douyin-check";
import { calculateOpExpiry } from "./op-expiry";

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
  checkDouyinId(douyinId: string): Promise<DouyinCheckResult>;
  cipher: SecretCipher;
  audit: AuditService;
};

type AccountListResult = PagedResponse<AccountDto> & { stats: AccountStats };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDto(value: AccountRecord & { _id: unknown }): AccountDto {
  return {
    _id: String(value._id),
    douyinId: value.douyinId,
    secUid: value.secUid,
    registeredAt: value.registeredAt.toISOString(),
    opName: value.opName,
    hasOpSecret: true,
    opExpiresAt: value.opExpiresAt.toISOString(),
    owner: value.owner,
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

export function createAccountsService({
  model = AccountModel,
  checkDouyinId,
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
      const detected = await checkDouyinId(input.douyinId);
      try {
        const created = await model.create({
          ...input,
          registeredAt: new Date(`${input.registeredAt}T00:00:00.000Z`),
          secUid: detected.secUid,
          accountStatus: detected.accountStatus,
          accountCheckedAt: detected.checkedAt,
          opSecret: cipher.encrypt(input.opSecret),
          opExpiresAt: calculateOpExpiry(input.opSecret)
        });
        await writeAudit(
          "account.created",
          [String(created._id)],
          Object.keys(input),
          context
        );
        return toDto(created);
      } catch (error) {
        throw duplicateError(error) ?? error;
      }
    },

    async get(id: string): Promise<AccountDto> {
      if (!Types.ObjectId.isValid(id)) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const account = await model.findById(id).lean();
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      return toDto(account as AccountRecord & { _id: unknown });
    },

    async list(rawQuery: unknown): Promise<AccountListResult> {
      const query = AccountListQuerySchema.parse(rawQuery);
      const filter: Record<string, unknown> = {};
      if (query.keyword) filter.searchText = new RegExp(escapeRegex(query.keyword.toLocaleLowerCase("zh-CN")), "i");
      if (query.saleStatus) filter.saleStatus = query.saleStatus;
      if (query.accountStatus) filter.accountStatus = query.accountStatus;
      if (query.registeredFrom || query.registeredTo) {
        filter.registeredAt = {
          ...(query.registeredFrom ? { $gte: new Date(`${query.registeredFrom}T00:00:00.000Z`) } : {}),
          ...(query.registeredTo ? { $lte: new Date(`${query.registeredTo}T23:59:59.999Z`) } : {})
        };
      }
      const skip = (query.page - 1) * query.pageSize;
      const [items, total, statusCounts] = await Promise.all([
        model.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
        model.countDocuments(filter),
        model.aggregate<{ _id: string; count: number }>([
          { $group: { _id: "$saleStatus", count: { $sum: 1 } } }
        ])
      ]);
      const statusMap = Object.fromEntries(statusCounts.map((item) => [item._id, item.count]));
      const abnormal = await model.countDocuments({ accountStatus: { $in: ["violation", "banned"] } });
      return {
        items: items.map((item) => toDto(item as AccountRecord & { _id: unknown })),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        stats: {
          total: Object.values(statusMap).reduce((sum, count) => sum + count, 0),
          unsold: statusMap.unsold ?? 0,
          sold: statusMap.sold ?? 0,
          abnormal
        }
      };
    },

    async update(id: string, rawPatch: unknown, context: AuditContext): Promise<AccountDto> {
      const patch = AccountInputSchema.partial().strict().parse(rawPatch);
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const changedFields = Object.keys(patch);

      if (patch.douyinId && patch.douyinId !== account.douyinId) {
        const detected = await checkDouyinId(patch.douyinId);
        account.secUid = detected.secUid;
        account.accountStatus = detected.accountStatus;
        account.accountCheckedAt = detected.checkedAt;
        changedFields.push("secUid", "accountStatus", "accountCheckedAt");
      }
      if (patch.opSecret) {
        account.opSecret = cipher.encrypt(patch.opSecret);
        account.opExpiresAt = calculateOpExpiry(patch.opSecret);
        changedFields.push("opExpiresAt");
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key === "opSecret") continue;
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
      return toDto(account);
    },

    async reveal(id: string, context: AuditContext): Promise<{ opSecret: string }> {
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      await writeAudit("account.secret_revealed", [id], ["opSecret"], context);
      return { opSecret: cipher.decrypt(account.opSecret) };
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
      patch: { saleStatus?: SaleStatus; owner?: string },
      context: AuditContext
    ) {
      if (!ids.length || ids.length > 500) throw new AppError(400, "BATCH_IDS_INVALID", "请选择 1 至 500 条数据");
      const allowedPatch: Record<string, unknown> = {};
      if (patch.saleStatus) allowedPatch.saleStatus = patch.saleStatus;
      if (patch.owner?.trim()) allowedPatch.owner = patch.owner.trim();
      if (!Object.keys(allowedPatch).length) throw new AppError(400, "BATCH_PATCH_EMPTY", "没有可修改的字段");
      const result = await model.updateMany({ _id: { $in: ids } }, { $set: allowedPatch });
      await writeAudit("account.batch_updated", ids, Object.keys(allowedPatch), context);
      return { updated: result.modifiedCount };
    },

    async recheck(id: string, context: AuditContext): Promise<AccountDto> {
      const account = await model.findById(id);
      if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "账号不存在");
      const detected = await checkDouyinId(account.douyinId);
      account.secUid = detected.secUid;
      account.accountStatus = detected.accountStatus;
      account.accountCheckedAt = detected.checkedAt;
      await account.save();
      await writeAudit("account.rechecked", [id], ["secUid", "accountStatus", "accountCheckedAt"], context);
      return toDto(account);
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
    }
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
export type { AccountInput, AccountListQuery, AuditContext };
