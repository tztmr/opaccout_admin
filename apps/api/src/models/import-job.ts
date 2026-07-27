import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";

export type ImportJobStatus = "queued" | "running" | "completed" | "failed";
export type DuplicateStrategy = "skip" | "update";

export type ImportRowFailure = {
  row: number;
  douyinId: string;
  code: string;
  message: string;
};

export type ImportJobRecord = {
  previewId: string;
  fileName: string;
  duplicateStrategy: DuplicateStrategy;
  status: ImportJobStatus;
  total: number;
  processed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  failures?: ImportRowFailure[];
  startedAt?: Date;
  completedAt?: Date;
  errorSummary?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportJobDocument = HydratedDocument<ImportJobRecord>;

const ImportJobSchema = new Schema<ImportJobRecord>(
  {
    previewId: { type: String, required: true, index: true },
    fileName: { type: String, required: true, maxlength: 255 },
    duplicateStrategy: { type: String, required: true, enum: ["skip", "update"] },
    status: {
      type: String,
      required: true,
      enum: ["queued", "running", "completed", "failed"],
      index: true
    },
    total: { type: Number, required: true, min: 0 },
    processed: { type: Number, required: true, default: 0, min: 0 },
    createdCount: { type: Number, required: true, default: 0, min: 0 },
    updatedCount: { type: Number, required: true, default: 0, min: 0 },
    skippedCount: { type: Number, required: true, default: 0, min: 0 },
    failedCount: { type: Number, required: true, default: 0, min: 0 },
    failures: {
      type: [
        {
          row: { type: Number, required: true, min: 1 },
          douyinId: { type: String, required: true, maxlength: 32 },
          code: { type: String, required: true, maxlength: 100 },
          message: { type: String, required: true, maxlength: 500 }
        }
      ],
      default: []
    },
    startedAt: Date,
    completedAt: Date,
    errorSummary: { type: String, maxlength: 1000 }
  },
  { timestamps: true, versionKey: false }
);

ImportJobSchema.index({ createdAt: -1 });

export const ImportJobModel: Model<ImportJobRecord> =
  (models.ImportJob as Model<ImportJobRecord> | undefined) ??
  model<ImportJobRecord>("ImportJob", ImportJobSchema);
