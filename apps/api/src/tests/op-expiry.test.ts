import { describe, expect, it } from "vitest";
import { calculateOpExpiry } from "../services/op-expiry";

describe("calculateOpExpiry", () => {
  it("adds exactly 5,184,000 seconds to the final pipe segment", () => {
    expect(calculateOpExpiry("a|b|1782303418").toISOString()).toBe(
      "2026-08-23T12:16:58.000Z"
    );
  });

  it.each(["a|b|", "a|b|178230341", "a|b|1782303418000", "a|b|not-time"])(
    "rejects invalid final timestamp %s",
    (secret) => {
      expect(() => calculateOpExpiry(secret)).toThrow("OP_SECRET_TIMESTAMP_INVALID");
    }
  );
});
