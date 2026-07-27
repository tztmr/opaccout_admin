import { model, models, Schema, type HydratedDocument } from "mongoose";

export type AuditLogRecord = {
  action: string;
  targetType: string;
  targetIds: string[];
  changedFields: string[];
  count: number;
  ip: string;
  userAgent: string;
  requestId: string;
  createdAt: Date;
};

export type AuditLogDocument = HydratedDocument<AuditLogRecord>;

const AuditLogSchema = new Schema<AuditLogRecord>(
  {
    action: { type: String, required: true, maxlength: 100 },
    targetType: { type: String, required: true, maxlength: 100 },
    targetIds: { type: [String], required: true, default: [] },
    changedFields: { type: [String], required: true, default: [] },
    count: { type: Number, required: true, min: 0 },
    ip: { type: String, required: true, maxlength: 128 },
    userAgent: { type: String, required: true, maxlength: 512 },
    requestId: { type: String, required: true, maxlength: 128 }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLogModel =
  models.AuditLog ?? model<AuditLogRecord>("AuditLog", AuditLogSchema);
