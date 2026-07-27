import {
  hashAdminPassword,
  verifyAdminPassword,
  type PasswordDigest
} from "./admin-credentials";

export type AdminCredentials = { username: string; password: string };
export type StoredAdmin = PasswordDigest & { username: string };
export type PasswordCodec = {
  hash(password: string): Promise<PasswordDigest>;
  verify(password: string, digest: PasswordDigest): Promise<boolean>;
};
export type AdminRepository = {
  exists(): Promise<boolean>;
  find(): Promise<StoredAdmin | null>;
  create(admin: StoredAdmin): Promise<void>;
};

export class AdminAlreadyExistsError extends Error {
  constructor() {
    super("administrator already exists");
    this.name = "AdminAlreadyExistsError";
  }
}

export type AdminAuthService = {
  needsSetup(): Promise<boolean>;
  setup(input: AdminCredentials): Promise<{ username: string }>;
  authenticate(input: AdminCredentials): Promise<{ username: string } | null>;
};

const defaultCodec: PasswordCodec = {
  hash: hashAdminPassword,
  verify: verifyAdminPassword
};

export function createAdminAuthService(
  repository: AdminRepository,
  passwordCodec: PasswordCodec = defaultCodec
): AdminAuthService {
  return {
    async needsSetup() {
      return !(await repository.exists());
    },
    async setup(input) {
      const username = input.username.trim();
      const digest = await passwordCodec.hash(input.password);
      await repository.create({ username, ...digest });
      return { username };
    },
    async authenticate(input) {
      const admin = await repository.find();
      if (!admin || input.username.trim() !== admin.username) return null;
      const valid = await passwordCodec.verify(input.password, admin);
      return valid ? { username: admin.username } : null;
    }
  };
}
