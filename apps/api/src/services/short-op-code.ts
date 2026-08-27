import { randomInt } from "node:crypto";
import { DEFAULT_OP_PROJECT, ShortOpCodeSchema } from "@douyin-admin/shared";
import type { Model } from "mongoose";
import { AppError } from "../middleware/errors";
import type { AccountRecord } from "../models/account";

const MIN_SHORT_OP_CODE = 100_000_000;
const MAX_SHORT_OP_CODE_EXCLUSIVE = 1_000_000_000;
const DEFAULT_MAX_ATTEMPTS = 12;

type ShortOpOptions = {
  randomInt?: typeof randomInt;
  maxAttempts?: number;
};

export type NewAccountRecord = Omit<
  AccountRecord,
  "shortOpCode" | "searchText" | "createdAt" | "updatedAt" | "opProject"
> & { opProject?: typeof DEFAULT_OP_PROJECT };

export function generateShortOpCode(
  randomIntImpl: typeof randomInt = randomInt
): string {
  return ShortOpCodeSchema.parse(
    String(randomIntImpl(MIN_SHORT_OP_CODE, MAX_SHORT_OP_CODE_EXCLUSIVE))
  );
}

function isShortOpDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const duplicate = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  return duplicate.code === 11000 && duplicate.keyPattern?.shortOpCode === 1;
}

function exhaustedError(): AppError {
  return new AppError(503, "SHORT_OP_EXHAUSTED", "短 OP 生成失败，请重试");
}

export async function createAccountWithShortOpRetry(
  model: Model<AccountRecord>,
  payload: NewAccountRecord,
  { randomInt: randomIntImpl = randomInt, maxAttempts = DEFAULT_MAX_ATTEMPTS }: ShortOpOptions = {}
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await model.create({
        ...payload,
        shortOpCode: generateShortOpCode(randomIntImpl),
        opProject: payload.opProject ?? DEFAULT_OP_PROJECT
      });
    } catch (error) {
      if (!isShortOpDuplicate(error)) throw error;
    }
  }
  throw exhaustedError();
}

export async function backfillMissingShortOps(
  model: Model<AccountRecord>,
  { randomInt: randomIntImpl = randomInt, maxAttempts = DEFAULT_MAX_ATTEMPTS }: ShortOpOptions = {}
): Promise<{ updated: number }> {
  let updated = 0;
  const cursor = model
    .find({
      opSecret: { $exists: true },
      $or: [
        { shortOpCode: { $exists: false } },
        { opProject: { $exists: false } }
      ]
    })
    .cursor();

  for await (const account of cursor) {
    const record = account as Pick<AccountRecord, "shortOpCode" | "opProject"> & { _id: unknown };
    if (record.shortOpCode) {
      const result = await model.updateOne(
        { _id: record._id, opProject: { $exists: false } },
        { $set: { opProject: DEFAULT_OP_PROJECT } }
      );
      updated += result.modifiedCount;
      continue;
    }

    let applied = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await model.updateOne(
          { _id: record._id, shortOpCode: { $exists: false } },
          {
            $set: {
              shortOpCode: generateShortOpCode(randomIntImpl),
              opProject: record.opProject ?? DEFAULT_OP_PROJECT
            }
          }
        );
        updated += result.modifiedCount;
        applied = true;
        break;
      } catch (error) {
        if (!isShortOpDuplicate(error)) throw error;
      }
    }
    if (!applied) throw exhaustedError();
  }

  return { updated };
}
