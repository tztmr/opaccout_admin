import {
  normalizeAccountColumnOrder,
  type AccountColumnId,
  type AccountKind
} from "@douyin-admin/shared";
import { SettingModel, type SettingRecord } from "../models/setting";

type AccountColumnOrderField = "googleColumnOrder" | "emailColumnOrder";

type AccountColumnSettingsUpdate = {
  $set?: Partial<Pick<SettingRecord, AccountColumnOrderField>>;
  $setOnInsert: Pick<SettingRecord, "key" | "defaultPageSize" | "sessionHours">;
};

export type AccountColumnSettingsModel = {
  findOneAndUpdate: (
    filter: { key: "admin" },
    update: AccountColumnSettingsUpdate,
    options: { new: true; upsert: true }
  ) => {
    lean: () => Promise<Partial<Record<AccountColumnOrderField, unknown>> | null>;
  };
};

const settingDefaults = {
  key: "admin" as const,
  defaultPageSize: 20,
  sessionHours: 12
};

function getColumnOrderField(accountKind: AccountKind): AccountColumnOrderField {
  return accountKind === "google" ? "googleColumnOrder" : "emailColumnOrder";
}

export function createAccountColumnSettingsService(
  model: AccountColumnSettingsModel = SettingModel as unknown as AccountColumnSettingsModel
) {
  async function getAccountColumnOrders(): Promise<Record<AccountKind, AccountColumnId[]>> {
    const settings = await model.findOneAndUpdate(
      { key: "admin" },
      { $setOnInsert: settingDefaults },
      { new: true, upsert: true }
    ).lean();

    return {
      google: normalizeAccountColumnOrder("google", settings?.googleColumnOrder),
      email: normalizeAccountColumnOrder("email", settings?.emailColumnOrder)
    };
  }

  async function getAccountColumnOrder(accountKind: AccountKind): Promise<AccountColumnId[]> {
    const orders = await getAccountColumnOrders();
    return orders[accountKind];
  }

  async function saveAccountColumnOrder(
    accountKind: AccountKind,
    rawOrder: unknown
  ): Promise<AccountColumnId[]> {
    const order = normalizeAccountColumnOrder(accountKind, rawOrder);
    const columnOrderField = getColumnOrderField(accountKind);
    await model.findOneAndUpdate(
      { key: "admin" },
      {
        $set: { [columnOrderField]: order },
        $setOnInsert: settingDefaults
      },
      { new: true, upsert: true }
    ).lean();
    return order;
  }

  return { getAccountColumnOrders, getAccountColumnOrder, saveAccountColumnOrder };
}

const accountColumnSettingsService = createAccountColumnSettingsService();

export const getAccountColumnOrders = accountColumnSettingsService.getAccountColumnOrders;
export const getAccountColumnOrder = accountColumnSettingsService.getAccountColumnOrder;
export const saveAccountColumnOrder = accountColumnSettingsService.saveAccountColumnOrder;
