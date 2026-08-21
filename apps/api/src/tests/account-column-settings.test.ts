import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  normalizeAccountColumnOrder,
  type AccountKind
} from "@douyin-admin/shared";
import {
  createAccountColumnSettingsService,
  type AccountColumnSettingsModel
} from "../services/account-column-settings";

type StoredSettings = {
  key: "admin";
  defaultPageSize: number;
  sessionHours: number;
  googleColumnOrder?: unknown[];
  emailColumnOrder?: unknown[];
};

function createSettingsRepository(initial?: Partial<StoredSettings>) {
  let stored: StoredSettings | undefined = initial
    ? {
      key: "admin",
      defaultPageSize: 20,
      sessionHours: 12,
      ...initial
    }
    : undefined;
  const updates: Array<{ $set?: Record<string, unknown> }> = [];

  return {
    model: {
      findOneAndUpdate(_filter: { key: "admin" }, update: {
        $set?: Partial<StoredSettings>;
        $setOnInsert?: StoredSettings;
      }) {
        updates.push(update as { $set?: Record<string, unknown> });
        if (!stored) stored = { ...update.$setOnInsert! };
        if (update.$set) stored = { ...stored, ...update.$set };
        return {
          lean: async () => {
            const result: Partial<Record<"googleColumnOrder" | "emailColumnOrder", unknown>> = {};
            if (stored?.googleColumnOrder !== undefined) {
              result.googleColumnOrder = stored.googleColumnOrder;
            }
            if (stored?.emailColumnOrder !== undefined) {
              result.emailColumnOrder = stored.emailColumnOrder;
            }
            return result;
          }
        };
      }
    } as AccountColumnSettingsModel,
    read() {
      return stored;
    },
    lastUpdate() {
      return updates.at(-1);
    }
  };
}

describe("account column settings service", () => {
  it("returns normalized defaults when a stored order is missing", async () => {
    const repository = createSettingsRepository();
    const service = createAccountColumnSettingsService(repository.model);

    await expect(service.getAccountColumnOrder("google")).resolves.toEqual(
      DEFAULT_ACCOUNT_COLUMN_ORDER.google
    );
  });

  it("normalizes every persisted google order without changing email settings", async () => {
    const repository = createSettingsRepository({
      googleColumnOrder: ["unknown", "remark", "remark", "email", "douyin"],
      emailColumnOrder: ["email", "douyin", "remark"]
    });
    const service = createAccountColumnSettingsService(repository.model);

    await expect(service.saveAccountColumnOrder(
      "google",
      ["unknown", "remark", "remark", "email", "douyin"]
    )).resolves.toEqual([
      "remark", "douyin", "password", "secuid", "date", "opname", "opsecret",
      "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status"
    ]);
    expect(repository.read()).toMatchObject({
      googleColumnOrder: [
        "remark", "douyin", "password", "secuid", "date", "opname", "opsecret",
        "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status"
      ],
      emailColumnOrder: ["email", "douyin", "remark"],
      defaultPageSize: 20,
      sessionHours: 12
    });
    expect(repository.lastUpdate()?.$set).toEqual({
      googleColumnOrder: [
        "remark", "douyin", "password", "secuid", "date", "opname", "opsecret",
        "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status"
      ]
    });
  });

  it("normalizes an empty or omitted email order to the complete default before storage", async () => {
    const repository = createSettingsRepository({ googleColumnOrder: ["remark", "douyin"] });
    const service = createAccountColumnSettingsService(repository.model);

    await expect(service.saveAccountColumnOrder("email", [])).resolves.toEqual(
      DEFAULT_ACCOUNT_COLUMN_ORDER.email
    );
    expect(repository.read()).toMatchObject({
      emailColumnOrder: DEFAULT_ACCOUNT_COLUMN_ORDER.email,
      googleColumnOrder: ["remark", "douyin"],
      defaultPageSize: 20,
      sessionHours: 12
    });
    expect(repository.lastUpdate()?.$set).toEqual({
      emailColumnOrder: DEFAULT_ACCOUNT_COLUMN_ORDER.email
    });

    await expect(service.saveAccountColumnOrder("email", undefined)).resolves.toEqual(
      DEFAULT_ACCOUNT_COLUMN_ORDER.email
    );
  });

  it("keeps valid email prefixes and appends omitted email columns in default order", async () => {
    const repository = createSettingsRepository();
    const service = createAccountColumnSettingsService(repository.model);
    const rawOrder: unknown = ["remark", "email", "douyin"];

    await expect(service.saveAccountColumnOrder("email", rawOrder)).resolves.toEqual(
      normalizeAccountColumnOrder("email", rawOrder)
    );
    expect(repository.read()?.emailColumnOrder).toEqual([
      "remark", "email", "douyin", "password", "secuid", "date", "opname", "opsecret",
      "shortop", "mobile", "project", "expiry", "owner", "region", "sale", "status"
    ]);
  });

  it.each(["google", "email"] as AccountKind[])("returns independently normalized %s orders", async (accountKind) => {
    const repository = createSettingsRepository({
      googleColumnOrder: ["remark", "remark", "email"],
      emailColumnOrder: ["email", "remark", "unknown"]
    });
    const service = createAccountColumnSettingsService(repository.model);

    await expect(service.getAccountColumnOrder(accountKind)).resolves.toEqual(
      accountKind === "google"
        ? ["remark", ...DEFAULT_ACCOUNT_COLUMN_ORDER.google.filter((id) => id !== "remark")]
        : ["email", "remark", ...DEFAULT_ACCOUNT_COLUMN_ORDER.email.filter((id) => id !== "email" && id !== "remark")]
    );
  });
});
