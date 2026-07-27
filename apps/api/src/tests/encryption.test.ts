import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretCipher } from "../services/encryption";

describe("secret encryption", () => {
  it("round-trips unicode secrets", () => {
    const cipher = createSecretCipher(randomBytes(32));
    const encrypted = cipher.encrypt("卡密|1782303418");

    expect(cipher.decrypt(encrypted)).toBe("卡密|1782303418");
  });

  it("uses a new IV for repeated encryption", () => {
    const cipher = createSecretCipher(randomBytes(32));

    expect(cipher.encrypt("same").iv).not.toBe(cipher.encrypt("same").iv);
  });

  it("rejects tampered ciphertext", () => {
    const cipher = createSecretCipher(randomBytes(32));
    const encrypted = cipher.encrypt("secret");
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from("changed").toString("base64")
    };

    expect(() => cipher.decrypt(tampered)).toThrow();
  });
});
