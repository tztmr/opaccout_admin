import { z } from "zod";
import { DEFAULT_OP_PROJECT, OpProjectSchema } from "./short-op";

export const SALE_STATUSES = [
  "unknown",
  "unsold",
  "sold",
  "disabled",
  "recovered"
] as const;
export const ACCOUNT_STATUSES = [
  "normal",
  "violation",
  "banned",
  "unknown",
  "op_invalid"
] as const;
export const DEFAULT_REGISTERED_REGION = "中国.香港";

export const SaleStatusSchema = z.enum(SALE_STATUSES);
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES);

export type SaleStatus = z.infer<typeof SaleStatusSchema>;
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  unknown: "未知",
  unsold: "未售卖",
  sold: "已售卖",
  disabled: "已停用",
  recovered: "已找回"
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  normal: "正常",
  violation: "违规",
  banned: "封禁",
  unknown: "未知",
  op_invalid: "OP失效"
};

export const AccountInputSchema = z
  .object({
    douyinId: z.string().trim().regex(/^\d+$/, "抖音号只能包含数字").max(32),
    registeredAt: z.iso.date(),
    opName: z.string().trim().max(100).default(""),
    opSecret: z.string().min(1, "OP卡密不能为空").max(4096),
    opProject: OpProjectSchema.default(DEFAULT_OP_PROJECT),
    owner: z.string().trim().min(1, "归属人不能为空").max(100),
    registeredRegion: z.preprocess((value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized ? normalized : undefined;
    }, z.string().trim().max(100).default(DEFAULT_REGISTERED_REGION)),
    saleStatus: SaleStatusSchema.default("unknown"),
    remark: z.string().trim().max(1000).default("")
  })
  .strict();

export type AccountInput = z.infer<typeof AccountInputSchema>;

const QueryBooleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const SortDirectionSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return "asc";
  if (typeof value === "string") return value.trim().toLowerCase();
  return value;
}, z.enum(["asc", "desc"]));

export const ACCOUNT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const ACCOUNT_PAGE_SIZE_ALL = "all" as const;

const AccountPageSizeSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return 20;
  if (typeof value === "string" && value.trim().toLowerCase() === "all") {
    return "all";
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
}, z.union([
  z.literal("all"),
  z.literal(20),
  z.literal(50),
  z.literal(100)
]));

export const AccountListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: AccountPageSizeSchema.default(20),
    keyword: z.string().trim().max(5000).optional(),
    sortDirection: SortDirectionSchema.default("asc"),
    saleStatus: SaleStatusSchema.optional(),
    accountStatus: AccountStatusSchema.optional(),
    owner: z.string().trim().min(1).max(100).optional(),
    registeredFrom: z.iso.date().optional(),
    registeredTo: z.iso.date().optional(),
    includeStats: QueryBooleanSchema.default(true)
  })
  .strict();

export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;

export type AccountDto = {
  _id: string;
  douyinId: string;
  secUid: string;
  registeredAt: string;
  opName: string;
  hasOpSecret: true;
  readonly shortOpCode: string;
  readonly opProject: "douyin";
  opExpiresAt: string;
  owner: string;
  registeredRegion: string;
  saleStatus: SaleStatus;
  accountStatus: AccountStatus;
  accountCheckedAt: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountStats = {
  total: number;
  unsold: number;
  sold: number;
  abnormal: number;
};
