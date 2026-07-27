import type { AccountStatus, SaleStatus } from "@douyin-admin/shared";
import type { Model } from "mongoose";
import { AppError } from "../middleware/errors";
import { AccountModel, type AccountRecord } from "../models/account";

export function resolveDetectedSaleStatus(
  accountStatus: AccountStatus,
  requested: SaleStatus
): SaleStatus {
  return accountStatus === "banned" ? "disabled" : requested;
}

export function assertBannedSaleStatusChange(
  accountStatus: AccountStatus,
  requested?: SaleStatus
): void {
  if (accountStatus === "banned" && requested && requested !== "disabled") {
    throw new AppError(
      409,
      "BANNED_ACCOUNT_SALE_STATUS_LOCKED",
      "封禁账号的售卖状态必须保持为已停用"
    );
  }
}

export async function normalizeBannedSaleStatuses(
  model: Model<AccountRecord> = AccountModel
): Promise<number> {
  const result = await model.updateMany(
    { accountStatus: "banned", saleStatus: { $ne: "disabled" } },
    { $set: { saleStatus: "disabled" } }
  );
  return result.modifiedCount;
}
