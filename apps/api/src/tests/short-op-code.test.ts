import type { Model } from "mongoose";
import { describe, expect, it } from "vitest";
import type { AccountRecord } from "../models/account";
import {
  backfillMissingShortOps,
  createAccountWithShortOpRetry,
  generateShortOpCode
} from "../services/short-op-code";

const encryptedValue = {
  version: 1 as const,
  iv: "aXY=",
  ciphertext: "Y2lwaGVy",
  authTag: "dGFn"
};

const payload = {
  douyinId: "94946893573",
  secUid: "MS4wLjABAAAA-fixture",
  registeredAt: new Date("2026-07-28T00:00:00.000Z"),
  opName: "星河",
  opSecret: encryptedValue,
  opExpiresAt: new Date("2026-08-23T12:16:58.000Z"),
  owner: "小王",
  registeredRegion: "中国.香港",
  saleStatus: "unknown" as const,
  accountStatus: "normal" as const,
  accountCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
  remark: ""
};

function sequence(...values: number[]) {
  let index = 0;
  return () => values[index++]!;
}

describe("short OP code allocation", () => {
  it("generates exactly nine digits with a non-zero first digit", () => {
    expect(generateShortOpCode(() => 123456789)).toBe("123456789");
  });

  it("rejects a random source that produces a non-nine-digit value", () => {
    expect(() => generateShortOpCode(() => 1_000_000_000)).toThrow();
  });

  it("retries only short OP duplicate-key failures and assigns the default project", async () => {
    let calls = 0;
    const model = {
      create: async (value: Record<string, unknown>) => {
        calls += 1;
        if (calls === 1) throw { code: 11000, keyPattern: { shortOpCode: 1 } };
        return value;
      }
    } as unknown as Model<AccountRecord>;

    await expect(
      createAccountWithShortOpRetry(model, payload, {
        randomInt: sequence(123456789, 987654321)
      })
    ).resolves.toMatchObject({ shortOpCode: "987654321", opProject: "douyin" });
  });

  it("does not retry a duplicate key on another account field", async () => {
    let calls = 0;
    const duplicate = { code: 11000, keyPattern: { douyinId: 1 } };
    const model = {
      create: async () => {
        calls += 1;
        throw duplicate;
      }
    } as unknown as Model<AccountRecord>;

    await expect(createAccountWithShortOpRetry(model, payload)).rejects.toBe(duplicate);
    expect(calls).toBe(1);
  });

  it("fails after twelve colliding short OP allocations", async () => {
    let calls = 0;
    const model = {
      create: async () => {
        calls += 1;
        throw { code: 11000, keyPattern: { shortOpCode: 1 } };
      }
    } as unknown as Model<AccountRecord>;

    await expect(createAccountWithShortOpRetry(model, payload)).rejects.toMatchObject({
      code: "SHORT_OP_EXHAUSTED",
      status: 503
    });
    expect(calls).toBe(12);
  });

  it("backfills missing values once and retries a duplicate only for its current record", async () => {
    const records = [
      { _id: "one", shortOpCode: undefined, opProject: undefined },
      { _id: "two", shortOpCode: undefined, opProject: undefined }
    ];
    const updates: Array<{ filter: unknown; update: unknown }> = [];
    let firstRecordAttempts = 0;
    const model = {
      find: () => ({ cursor: async function* () { yield* records; } }),
      updateOne: async (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        if ((filter as { _id: string })._id === "one" && firstRecordAttempts++ === 0) {
          throw { code: 11000, keyPattern: { shortOpCode: 1 } };
        }
        return { modifiedCount: 1 };
      }
    } as unknown as Model<AccountRecord>;

    await expect(
      backfillMissingShortOps(model, {
        randomInt: sequence(123456789, 987654321, 223456789)
      })
    ).resolves.toEqual({ updated: 2 });
    expect(updates).toEqual([
      {
        filter: { _id: "one", shortOpCode: { $exists: false } },
        update: { $set: { shortOpCode: "123456789", opProject: "douyin" } }
      },
      {
        filter: { _id: "one", shortOpCode: { $exists: false } },
        update: { $set: { shortOpCode: "987654321", opProject: "douyin" } }
      },
      {
        filter: { _id: "two", shortOpCode: { $exists: false } },
        update: { $set: { shortOpCode: "223456789", opProject: "douyin" } }
      }
    ]);
  });

  it("does not rewrite records after a completed backfill", async () => {
    const model = {
      find: () => ({ cursor: async function* () {} }),
      updateOne: async () => ({ modifiedCount: 1 })
    } as unknown as Model<AccountRecord>;

    await expect(backfillMissingShortOps(model)).resolves.toEqual({ updated: 0 });
  });
});
