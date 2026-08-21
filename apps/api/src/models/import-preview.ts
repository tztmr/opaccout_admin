import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";
import type { AccountKind } from "@douyin-admin/shared";

export type ImportRowError = {
  row: number;
  field: string;
  code: string;
  message: string;
};

export type ImportPreviewRecord = {
  fileName: string;
  fileType: "xlsx" | "xls" | "csv";
  accountKind: AccountKind;
  ownerSessionId: string;
  stagedRows: unknown[];
  rowErrors: ImportRowError[];
  totalRows: number;
  validRows: number;
  expiresAt: Date;
  createdAt: Date;
};

export type ImportPreviewDocument = HydratedDocument<ImportPreviewRecord>;

const RowErrorSchema = new Schema<ImportRowError>(
  {
    row: { type: Number, required: true },
    field: { type: String, required: true },
    code: { type: String, required: true },
    message: { type: String, required: true }
  },
  { _id: false }
);

const ImportPreviewSchema = new Schema<ImportPreviewRecord>(
  {
    fileName: { type: String, required: true, maxlength: 255 },
    fileType: { type: String, required: true, enum: ["xlsx", "xls", "csv"] },
    accountKind: { type: String, required: true, enum: ["google", "email"], default: "google" },
    ownerSessionId: { type: String, required: true, index: true },
    stagedRows: { type: [Schema.Types.Mixed], required: true, default: [] },
    rowErrors: { type: [RowErrorSchema], required: true, default: [] },
    totalRows: { type: Number, required: true, min: 0 },
    validRows: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

ImportPreviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ImportPreviewModel: Model<ImportPreviewRecord> =
  (models.ImportPreview as Model<ImportPreviewRecord> | undefined) ??
  model<ImportPreviewRecord>("ImportPreview", ImportPreviewSchema);
