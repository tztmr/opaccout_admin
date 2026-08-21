import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";
import {
  ACCOUNT_COLUMN_IDS,
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  type AccountColumnId
} from "@douyin-admin/shared";

export type SettingRecord = {
  key: "admin";
  defaultPageSize: number;
  sessionHours: number;
  googleColumnOrder: AccountColumnId[];
  emailColumnOrder: AccountColumnId[];
  createdAt: Date;
  updatedAt: Date;
};

export type SettingDocument = HydratedDocument<SettingRecord>;

const SettingSchema = new Schema<SettingRecord>(
  {
    key: { type: String, required: true, enum: ["admin"], unique: true },
    defaultPageSize: { type: Number, required: true, min: 10, max: 100 },
    sessionHours: { type: Number, required: true, min: 1, max: 168 },
    googleColumnOrder: {
      type: [String],
      enum: ACCOUNT_COLUMN_IDS,
      default: () => [...DEFAULT_ACCOUNT_COLUMN_ORDER.google]
    },
    emailColumnOrder: {
      type: [String],
      enum: ACCOUNT_COLUMN_IDS,
      default: () => [...DEFAULT_ACCOUNT_COLUMN_ORDER.email]
    }
  },
  { timestamps: true, versionKey: false }
);

export const SettingModel: Model<SettingRecord> =
  (models.Setting as Model<SettingRecord> | undefined) ??
  model<SettingRecord>("Setting", SettingSchema);

type LegacySettingCollection = {
  updateMany: (
    filter: { qqOpSocksProxyPool: { $exists: true } },
    update: { $unset: { qqOpSocksProxyPool: "" } }
  ) => Promise<{ modifiedCount: number }>;
};

export async function removeLegacyOpProxySettings(
  collection: LegacySettingCollection = SettingModel.collection as unknown as LegacySettingCollection
): Promise<number> {
  const result = await collection.updateMany(
    { qqOpSocksProxyPool: { $exists: true } },
    { $unset: { qqOpSocksProxyPool: "" } }
  );
  return result.modifiedCount;
}
