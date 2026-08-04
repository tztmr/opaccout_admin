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
    expect(Buffer.from(parsed.searchParams.get("pasteboard")!, "base64").subarray(0, 8).toString("ascii")).toBe(
      "bplist00",
    );
  });

  it("rejects a non-numeric project AppID", () => {
    expect(() => buildOpWakeUrl("fixture-openid|fixture-access|fixture-pay", "app-id")).toThrow(
      "项目 AppID 格式不正确",
    );
  });
});
