import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  verifyAdminPassword
} from "../services/admin-credentials";

describe("administrator credentials", () => {
  it("stores a salted digest instead of the plaintext password", async () => {
    const password = "a-strong-admin-password";
    const first = await hashAdminPassword(password);
    const second = await hashAdminPassword(password);

    expect(first.passwordSalt).not.toContain(password);
    expect(first.passwordHash).not.toContain(password);
    expect(first.passwordSalt).not.toBe(second.passwordSalt);
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  it("accepts only the password used to create the digest", async () => {
    const digest = await hashAdminPassword("a-strong-admin-password");

    await expect(
      verifyAdminPassword("a-strong-admin-password", digest)
    ).resolves.toBe(true);
    await expect(
      verifyAdminPassword("a-different-admin-password", digest)
    ).resolves.toBe(false);
  });

  it("rejects a malformed stored digest without throwing", async () => {
    await expect(
      verifyAdminPassword("a-strong-admin-password", {
        passwordSalt: "not-base64!",
        passwordHash: "not-base64!"
      })
    ).resolves.toBe(false);
  });
});
