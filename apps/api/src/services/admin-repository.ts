import { AdminModel } from "../models/admin";
import {
  AdminAlreadyExistsError,
  type AdminRepository
} from "./admin-auth";

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function createMongooseAdminRepository(): AdminRepository {
  return {
    async exists() {
      return (await AdminModel.exists({ _id: "primary" })) !== null;
    },
    async find() {
      const admin = await AdminModel.findById("primary").lean();
      return admin
        ? {
            username: admin.username,
            passwordSalt: admin.passwordSalt,
            passwordHash: admin.passwordHash
          }
        : null;
    },
    async create(admin) {
      try {
        await AdminModel.create({ _id: "primary", ...admin });
      } catch (error) {
        if (isDuplicateKey(error)) throw new AdminAlreadyExistsError();
        throw error;
      }
    }
  };
}
