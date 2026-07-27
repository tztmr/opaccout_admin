import { describe, expect, it } from "vitest";
import {
  AdminAlreadyExistsError,
  createAdminAuthService
} from "../services/admin-auth";
import { createMemoryAdminRepository } from "./admin-test-helper";

const credentials = {
  username: "admin",
  password: "a-long-admin-password"
};

describe("administrator authentication service", () => {
  it("requires setup only until the first administrator is created", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());

    await expect(service.needsSetup()).resolves.toBe(true);
    await expect(service.setup(credentials)).resolves.toEqual({
      username: "admin"
    });
    await expect(service.needsSetup()).resolves.toBe(false);
  });

  it("never replaces the first administrator", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    await service.setup(credentials);

    await expect(
      service.setup({
        username: "replacement",
        password: "another-long-password"
      })
    ).rejects.toBeInstanceOf(AdminAlreadyExistsError);
    await expect(service.authenticate(credentials)).resolves.toEqual({
      username: "admin"
    });
  });

  it("allows only one of two concurrent setup attempts", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    const results = await Promise.allSettled([
      service.setup(credentials),
      service.setup({
        username: "other",
        password: "another-long-password"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1
    );
  });

  it("authenticates exact trimmed usernames and the correct password", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    await service.setup({ ...credentials, username: "  admin  " });

    await expect(service.authenticate(credentials)).resolves.toEqual({
      username: "admin"
    });
    await expect(
      service.authenticate({
        username: "Admin",
        password: credentials.password
      })
    ).resolves.toBeNull();
    await expect(
      service.authenticate({
        username: "admin",
        password: "incorrect-long-password"
      })
    ).resolves.toBeNull();
  });
});
