import { randomBytes } from "node:crypto";
import {
  DEFAULT_ACCOUNT_COLUMN_ORDER,
  type AccountColumnId,
  type AccountKind
} from "@douyin-admin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import { getAccountColumnOrder } from "../services/account-column-settings";
import { createSecretCipher } from "../services/encryption";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

vi.mock("../services/account-column-settings", () => ({
  getAccountColumnOrder: vi.fn()
}));

const getSavedColumnOrder = vi.mocked(getAccountColumnOrder);

describe("imports routes", () => {
  beforeEach(() => {
    getSavedColumnOrder.mockReset();
    getSavedColumnOrder.mockImplementation(async (accountKind: AccountKind) => [
      ...DEFAULT_ACCOUNT_COLUMN_ORDER[accountKind]
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encrypts account passwords before persisting import previews", async () => {
    const create = vi.spyOn(ImportPreviewModel, "create").mockResolvedValue({
      id: "preview-id"
    } as never);
    const cipher = createSecretCipher(randomBytes(32));
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({ config: testConfig, adminAuth, cipher });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const csv = [
      "抖音号,邮箱,密码,注册时间,OP卡密,归属人",
      "94946893573,mail@example.com,preview-pass,2026-07-27,a|b|1782303418,小王"
    ].join("\n");
    const response = await agent
      .post("/api/imports/preview")
      .field("accountKind", "email")
      .attach("file", Buffer.from(csv, "utf8"), "accounts.csv");

    expect(response.status).toBe(201);
    const createdPreview = create.mock.calls[0]?.[0] as unknown as {
      accountKind: string;
      stagedRows: Array<{
        email: string;
        accountPassword?: Parameters<typeof cipher.decrypt>[0];
        opSecret: Parameters<typeof cipher.decrypt>[0];
      }>;
    } | undefined;
    expect(createdPreview).toBeDefined();
    const stagedRows = createdPreview!.stagedRows as Array<{
      email: string;
      accountPassword?: Parameters<typeof cipher.decrypt>[0];
      opSecret: Parameters<typeof cipher.decrypt>[0];
    }>;
    expect(stagedRows[0]?.accountPassword).toEqual(expect.objectContaining({
      version: 1,
      ciphertext: expect.any(String)
    }));
    expect(createdPreview!.accountKind).toBe("email");
    expect(stagedRows[0]?.email).toBe("mail@example.com");
    expect(stagedRows[0]?.opSecret).toEqual(expect.objectContaining({
      version: 1,
      ciphertext: expect.any(String)
    }));
    expect(cipher.decrypt(stagedRows[0]!.accountPassword!)).toBe("preview-pass");
    expect(cipher.decrypt(stagedRows[0]!.opSecret)).toBe("a|b|1782303418");
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("preview-pass");
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("a|b|1782303418");
    expect(response.body.rows[0]).toMatchObject({
      accountKind: "email",
      email: "mail@example.com",
      opSecret: "••••••"
    });
  });

  it("persists the preview kind onto its import job", async () => {
    const preview = {
      id: "preview-id",
      fileName: "accounts.csv",
      validRows: 1,
      accountKind: "email"
    };
    vi.spyOn(ImportPreviewModel, "findOne").mockResolvedValue(preview as never);
    const create = vi.spyOn(ImportJobModel, "create").mockResolvedValue({
      id: "job-id"
    } as never);
    const cipher = createSecretCipher(randomBytes(32));
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({ config: testConfig, adminAuth, cipher });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const response = await agent.post("/api/imports/execute").send({
      previewId: "preview-id",
      duplicateStrategy: "skip"
    });

    expect(response.status).toBe(202);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      previewId: "preview-id",
      accountKind: "email"
    }));
  });

  it("uses independent saved kind orders for templates and ignores query order", async () => {
    const googleOrder: AccountColumnId[] = [
      "remark", "mobile", "douyin", "password", "secuid", "date",
      "opname", "opsecret", "shortop", "project", "expiry", "owner",
      "region", "sale", "status"
    ];
    const emailOrder: AccountColumnId[] = [
      "email", "mobile", "remark", "douyin", "password", "secuid", "date",
      "opname", "opsecret", "shortop", "project", "expiry", "owner",
      "region", "sale", "status"
    ];
    getSavedColumnOrder.mockImplementation(async (accountKind) =>
      accountKind === "google" ? googleOrder : emailOrder
    );
    const cipher = createSecretCipher(randomBytes(32));
    const adminAuth = await createTestAdminAuth({
      username: "admin",
      password: "a-long-admin-password"
    });
    const app = createApp({ config: testConfig, adminAuth, cipher });
    const agent = new request.agent(app);
    await agent.post("/api/auth/login").send({
      username: "admin",
      password: "a-long-admin-password"
    });

    const google = await agent.get(
      "/api/imports/template?format=csv&accountKind=google&columnOrder=email"
    );
    const email = await agent.get(
      "/api/imports/template?format=csv&accountKind=email&columnOrder=remark"
    );

    expect(google.status).toBe(200);
    expect(email.status).toBe(200);
    expect(google.text.trim()).toBe(
      "备注,手机号,抖音号,密码,注册时间,OP名称,OP卡密,项目,归属人,注册地区,售卖状态"
    );
    expect(google.text).not.toContain("邮箱");
    expect(email.text.trim()).toBe(
      "邮箱,手机号,备注,抖音号,密码,注册时间,OP名称,OP卡密,项目,归属人,注册地区,售卖状态"
    );
    expect(getSavedColumnOrder.mock.calls).toEqual([["google"], ["email"]]);
  });
});
