import { describe, expect, it } from "vitest";
import {
  DEFAULT_OP_PROJECT,
  OP_PROJECTS,
  PUBLIC_OP_API_URL,
  PUBLIC_OP_ORIGIN,
  PublicOpResolveRequestSchema,
  ShortOpCodeSchema
} from "./short-op";

describe("ShortOpCodeSchema", () => {
  it("accepts a nine-digit code that does not begin with zero", () => {
    expect(ShortOpCodeSchema.parse("123456789")).toBe("123456789");
  });

  it("rejects a nine-digit code that begins with zero", () => {
    expect(() => ShortOpCodeSchema.parse("012345678")).toThrow();
  });
});

describe("public OP contract", () => {
  it("uses the Douyin project as the default public OP project", () => {
    expect(DEFAULT_OP_PROJECT).toBe("douyin");
    expect(OP_PROJECTS.douyin).toEqual({
      key: "douyin",
      name: "抖音",
      appId: "1105602870"
    });
  });

  it("accepts only a code in a public OP resolve request", () => {
    expect(PublicOpResolveRequestSchema.parse({ code: "123456789" })).toEqual({
      code: "123456789"
    });
    expect(() =>
      PublicOpResolveRequestSchema.parse({ code: "123456789", extra: true })
    ).toThrow();
  });

  it("builds the public resolve endpoint from the public origin", () => {
    expect(PUBLIC_OP_ORIGIN).toBe("https://op.tztright.qzz.io");
    expect(PUBLIC_OP_API_URL).toBe("https://op.tztright.qzz.io/api/op/resolve");
  });
});
