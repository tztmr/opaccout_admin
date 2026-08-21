import { describe, expect, it } from "vitest";
import { buildAccountKindFilter, resolveAccountKind } from "../services/account-kind";

describe("account kind compatibility", () => {
  it("includes untyped historical records in Google lists", () => {
    expect(buildAccountKindFilter("google")).toEqual({
      $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }]
    });
  });

  it("filters email records explicitly", () => {
    expect(buildAccountKindFilter("email")).toEqual({ accountKind: "email" });
  });

  it("resolves missing historical account kinds as Google", () => {
    expect(resolveAccountKind(undefined)).toBe("google");
  });
});
