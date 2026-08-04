import { describe, expect, it } from "vitest";

import { buildOpWakeUrl, parseOpToken } from "../services/op-wake-url.js";

describe("OP wake URL encoding", () => {
  it("preserves all five OP fields", () => {
    expect(parseOpToken("fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418")).toEqual({
      openid: "fixture-openid",
      accessToken: "fixture-access",
      payToken: "fixture-pay",
      pfKey: "fixture-pfkey",
      authTime: "1782303418",
    });
  });

  it("uses reference defaults for omitted pfkey and auth time", () => {
    expect(parseOpToken("fixture-openid|fixture-access|fixture-pay")).toEqual({
      openid: "fixture-openid",
      accessToken: "fixture-access",
      payToken: "fixture-pay",
      pfKey: "65d0a30bedbc73f53d8370141e6220df",
      authTime: "",
    });
  });

  it("rejects incomplete OP values", () => {
    expect(() => parseOpToken("fixture-openid|fixture-access")).toThrow("OP 数据号格式不正确");
  });

  it("rejects OP values with extra segments or a trailing separator", () => {
    expect(() => parseOpToken("fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418|extra")).toThrow(
      "OP 数据号格式不正确",
    );
    expect(() => parseOpToken("fixture-openid|fixture-access|fixture-pay|")).toThrow(
      "OP 数据号格式不正确",
    );
  });

  it("encodes a binary plist in the exact project wake URL", () => {
    const url = buildOpWakeUrl(
      "fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418",
      " 1105602870 ",
    );
    const parsed = new URL(url);

    expect(`${parsed.protocol}//${parsed.host}${parsed.pathname}`).toBe(
      "tencent1105602870://qzapp/mqzone/0",
    );
    expect(parsed.searchParams.get("objectlocation")).toBe("url");
    const payload = Buffer.from(parsed.searchParams.get("pasteboard")!, "base64");
    expectBinaryPlistStructure(payload);
    for (const field of ["fixture-openid", "fixture-access", "fixture-pay", "fixture-pfkey", "1782303418"]) {
      expect(payload.includes(Buffer.from(field, "ascii"))).toBe(true);
    }
  });

  it("rejects a non-numeric project AppID", () => {
    expect(() => buildOpWakeUrl("fixture-openid|fixture-access|fixture-pay", "app-id")).toThrow(
      "项目 AppID 格式不正确",
    );
  });
});

function expectBinaryPlistStructure(payload: Buffer): void {
  expect(payload.subarray(0, 8).toString("ascii")).toBe("bplist00");
  expect(payload.length).toBeGreaterThan(40);

  const trailerOffset = payload.length - 32;
  const offsetSize = payload.readUInt8(trailerOffset + 6);
  const objectRefSize = payload.readUInt8(trailerOffset + 7);
  const objectCount = Number(payload.readBigUInt64BE(trailerOffset + 8));
  const offsetTableOffset = Number(payload.readBigUInt64BE(trailerOffset + 24));

  expect(offsetSize).toBeGreaterThan(0);
  expect(objectRefSize).toBeGreaterThan(0);
  expect(objectCount).toBeGreaterThan(0);
  expect(offsetTableOffset).toBeGreaterThanOrEqual(8);
  expect(offsetTableOffset + objectCount * offsetSize).toBe(trailerOffset);

  let previousOffset = 7;
  for (let index = 0; index < objectCount; index += 1) {
    const offset = readUnsignedInteger(payload, offsetTableOffset + index * offsetSize, offsetSize);
    expect(offset).toBeGreaterThan(previousOffset);
    expect(offset).toBeLessThan(offsetTableOffset);
    previousOffset = offset;
  }
}

function readUnsignedInteger(buffer: Buffer, start: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + buffer.readUInt8(start + index);
  }
  return value;
}
