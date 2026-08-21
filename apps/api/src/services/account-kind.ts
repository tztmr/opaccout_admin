import type { AccountKind } from "@douyin-admin/shared";

export function resolveAccountKind(value: AccountKind | undefined): AccountKind {
  return value ?? "google";
}

export function buildAccountKindFilter(accountKind: AccountKind) {
  return accountKind === "google"
    ? { $or: [{ accountKind: "google" }, { accountKind: { $exists: false } }] }
    : { accountKind: "email" };
}
