import {
  AdminAlreadyExistsError,
  createAdminAuthService,
  type AdminCredentials,
  type AdminRepository,
  type StoredAdmin
} from "../services/admin-auth";

export function createMemoryAdminRepository(): AdminRepository {
  let value: StoredAdmin | null = null;
  return {
    async exists() {
      return value !== null;
    },
    async find() {
      return value ? { ...value } : null;
    },
    async create(admin) {
      if (value) throw new AdminAlreadyExistsError();
      value = { ...admin };
    }
  };
}

export async function createTestAdminAuth(
  initial?: AdminCredentials
) {
  const service = createAdminAuthService(createMemoryAdminRepository());
  if (initial) await service.setup(initial);
  return service;
}
