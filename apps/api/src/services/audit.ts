import { AuditLogModel, type AuditLogRecord } from "../models/audit-log";

const ALLOWED_CHANGED_FIELDS = new Set([
  "douyinId",
  "email",
  "secUid",
  "registeredAt",
  "opName",
  "opSecret",
  "accountPassword",
  "opExpiresAt",
  "owner",
  "saleStatus",
  "accountStatus",
  "accountCheckedAt",
  "remark"
]);

export type AuditEvent = Omit<AuditLogRecord, "createdAt">;

type AuditWriter = {
  create(value: AuditEvent): Promise<unknown>;
};

function sanitizeInline(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

export function createAuditService(writer: AuditWriter = AuditLogModel) {
  return {
    async write(event: AuditEvent): Promise<void> {
      const accountKind = event.accountKind === "google" || event.accountKind === "email"
        ? event.accountKind
        : undefined;
      await writer.create({
        action: sanitizeInline(event.action, 100),
        targetType: sanitizeInline(event.targetType, 100),
        targetIds: event.targetIds.map((value) => sanitizeInline(value, 128)),
        changedFields: [
          ...new Set(event.changedFields.filter((field) => ALLOWED_CHANGED_FIELDS.has(field)))
        ],
        ...(accountKind ? { accountKind } : {}),
        count: event.count,
        ip: sanitizeInline(event.ip, 128),
        userAgent: sanitizeInline(event.userAgent, 512),
        requestId: sanitizeInline(event.requestId, 128)
      });
    }
  };
}

export const auditService = createAuditService();
