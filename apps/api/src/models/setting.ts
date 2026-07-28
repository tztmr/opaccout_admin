import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";

export type SettingRecord = {
  key: "admin";
  defaultPageSize: number;
  sessionHours: number;
  qqOpSocksProxyPool: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SettingDocument = HydratedDocument<SettingRecord>;

const SettingSchema = new Schema<SettingRecord>(
  {
    key: { type: String, required: true, enum: ["admin"], unique: true },
    defaultPageSize: { type: Number, required: true, min: 10, max: 100 },
    sessionHours: { type: Number, required: true, min: 1, max: 168 },
    qqOpSocksProxyPool: { type: String, required: true, default: "" }
  },
  { timestamps: true, versionKey: false }
);

export const SettingModel: Model<SettingRecord> =
  (models.Setting as Model<SettingRecord> | undefined) ??
  model<SettingRecord>("Setting", SettingSchema);
