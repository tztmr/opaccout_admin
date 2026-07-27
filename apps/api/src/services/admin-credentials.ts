import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const SALT_BYTES = 16;
const HASH_BYTES = 64;

export type PasswordDigest = {
  passwordSalt: string;
  passwordHash: string;
};

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 ? decoded : null;
}

export async function hashAdminPassword(
  password: string
): Promise<PasswordDigest> {
  const salt = randomBytes(SALT_BYTES);
  const hash = (await derive(password, salt, HASH_BYTES)) as Buffer;
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64")
  };
}

export async function verifyAdminPassword(
  password: string,
  digest: PasswordDigest
): Promise<boolean> {
  const salt = decodeBase64(digest.passwordSalt);
  const expected = decodeBase64(digest.passwordHash);
  if (!salt || !expected || expected.length !== HASH_BYTES) return false;
  const actual = (await derive(password, salt, HASH_BYTES)) as Buffer;
  return timingSafeEqual(actual, expected);
}
