import type { Model } from "mongoose";
import type { AccountRecord } from "../models/account";
import type { EncryptedValue, SecretCipher } from "./encryption";

const NINETY_DAYS_SECONDS = 7_776_000;

export function calculateOpExpiry(secret: string): Date {
  const separatorIndex = secret.lastIndexOf("|");
  const lastSegment = separatorIndex >= 0 ? secret.slice(separatorIndex + 1) : "";

  if (!/^\d{10}$/.test(lastSegment)) {
    throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  }

  const sourceSeconds = Number(lastSegment);
  const expiresAt = new Date((sourceSeconds + NINETY_DAYS_SECONDS) * 1000);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  }

  return expiresAt;
}

export type OpExpiryBackfillResult = {
  updated: number;
  unchanged: number;
  failed: number;
};

type OpExpiryBackfillRecord = {
  _id: unknown;
  opExpiresAt?: Date;
  opSecret?: EncryptedValue;
};

export async function backfillOpExpiries(
  model: Model<AccountRecord>,
  cipher: SecretCipher
): Promise<OpExpiryBackfillResult> {
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  const cursor = model.find({}).cursor();
  for await (const account of cursor) {
    const record = account as OpExpiryBackfillRecord;
    if (!record.opSecret) {
      unchanged += 1;
      continue;
    }

    try {
      const secret = cipher.decrypt(record.opSecret);
      const nextExpiresAt = calculateOpExpiry(secret);
      const current = record.opExpiresAt?.getTime();
      if (current === nextExpiresAt.getTime()) {
        unchanged += 1;
        continue;
      }

      const result = await model.updateOne(
        { _id: record._id },
        { $set: { opExpiresAt: nextExpiresAt } }
      );
      if (result.modifiedCount > 0) {
        updated += 1;
      } else {
        unchanged += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { updated, unchanged, failed };
}
