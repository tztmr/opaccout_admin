import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes
} from "node:crypto";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_LENGTH = 12;

export type EncryptedValue = {
  version: 1;
  iv: string;
  ciphertext: string;
  authTag: string;
};

export type SecretCipher = {
  encrypt(value: string): EncryptedValue;
  decrypt(value: EncryptedValue): string;
};

export function createSecretCipher(key: Buffer): SecretCipher {
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY_MUST_BE_32_BYTES");
  }

  return {
    encrypt(value) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final()
      ]);

      return {
        version: 1,
        iv: iv.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64")
      };
    },

    decrypt(value) {
      if (value.version !== 1) {
        throw new Error("ENCRYPTED_VALUE_VERSION_UNSUPPORTED");
      }

      const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(value.iv, "base64")
      );
      decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64")),
        decipher.final()
      ]);

      return plaintext.toString("utf8");
    }
  };
}
