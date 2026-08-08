import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";

export type SettingRecord = {
  key: "admin";
  defaultPageSize: number;
  sessionHours: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SettingDocument = HydratedDocument<SettingRecord>;

const SettingSchema = new Schema<SettingRecord>(
  {
    key: { type: String, required: true, enum: ["admin"], unique: true },
    defaultPageSize: { type: Number, required: true, min: 10, max: 100 },
    sessionHours: { type: Number, required: true, min: 1, max: 168 }
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
