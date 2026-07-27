import { model, models, Schema, type HydratedDocument } from "mongoose";

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

export const SettingModel =
  models.Setting ?? model<SettingRecord>("Setting", SettingSchema);
