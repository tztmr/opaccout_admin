import { z } from "zod";

export const SALE_STATUSES = [
  "unknown",
  "unsold",
  "sold",
  "disabled",
  "recovered"
] as const;
export const ACCOUNT_STATUSES = ["normal", "violation", "banned"] as const;

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
  banned: "封禁"
};

export const AccountInputSchema = z
  .object({
    douyinId: z.string().trim().regex(/^\d+$/, "抖音号只能包含数字").max(32),
    registeredAt: z.iso.date(),
    opName: z.string().trim().max(100).default(""),
    opSecret: z.string().min(1, "OP卡密不能为空").max(4096),
    owner: z.string().trim().min(1, "归属人不能为空").max(100),
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

export const AccountListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().trim().max(200).optional(),
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
  opExpiresAt: string;
  owner: string;
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
