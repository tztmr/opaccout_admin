import { describe, expect, it, vi } from "vitest";
import { backfillOpExpiries, calculateOpExpiry } from "../services/op-expiry";

const encryptedValue = {
  version: 1 as const,
  iv: "aXY=",
  ciphertext: "Y2lwaGVy",
  authTag: "dGFn"
};

describe("calculateOpExpiry", () => {
  it("adds exactly 7,776,000 seconds to the final pipe segment", () => {
    expect(calculateOpExpiry("a|b|1782303418").toISOString()).toBe(
      "2026-09-22T12:16:58.000Z"
    );
  });

  it.each(["a|b|", "a|b|178230341", "a|b|1782303418000", "a|b|not-time"])(
    "rejects invalid final timestamp %s",
    (secret) => {
      expect(() => calculateOpExpiry(secret)).toThrow("OP_SECRET_TIMESTAMP_INVALID");
    }
  );
});

describe("backfillOpExpiries", () => {
  it("treats an intentionally missing OP secret as unchanged", async () => {
    const model = {
      find: () => ({
        cursor: async function* () {
          yield { _id: "without-op" };
        }
      }),
      updateOne: vi.fn()
    };
    const cipher = { encrypt: vi.fn(), decrypt: vi.fn() };

    await expect(backfillOpExpiries(model as never, cipher)).resolves.toEqual({
      updated: 0,
      unchanged: 1,
      failed: 0
    });
    expect(cipher.decrypt).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it("rewrites 60-day local expiries to 90 days from the OP auth_time", async () => {
    const updates: Array<{ filter: unknown; update: unknown }> = [];
    const model = {
      find: () => ({
        cursor: async function* () {
          yield {
            _id: "one",
            opSecret: encryptedValue,
            // old 60-day value for auth_time 1782303418
            opExpiresAt: new Date("2026-08-23T12:16:58.000Z")
          };
          yield {
            _id: "two",
            opSecret: encryptedValue,
            // already 90-day value
            opExpiresAt: new Date("2026-09-22T12:16:58.000Z")
          };
        }
      }),
      updateOne: async (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        return { modifiedCount: 1 };
      }
    };
    const cipher = {
      encrypt: vi.fn(),
      decrypt: () => "openid|token|pay|pfkey|1782303418"
    };

    await expect(backfillOpExpiries(model as never, cipher)).resolves.toEqual({
      updated: 1,
      unchanged: 1,
      failed: 0
    });
    expect(updates).toEqual([
      {
        filter: { _id: "one" },
        update: { $set: { opExpiresAt: new Date("2026-09-22T12:16:58.000Z") } }
      }
    ]);
  });

  it("counts decrypt failures without writing secrets into the result", async () => {
    const model = {
      find: () => ({
        cursor: async function* () {
          yield { _id: "bad", opSecret: encryptedValue, opExpiresAt: new Date() };
        }
      }),
      updateOne: async () => ({ modifiedCount: 1 })
    };
    const cipher = {
      encrypt: vi.fn(),
      decrypt: () => {
        throw new Error("cipher failed");
      }
    };

    await expect(backfillOpExpiries(model as never, cipher)).resolves.toEqual({
      updated: 0,
      unchanged: 0,
      failed: 1
    });
  });
});
