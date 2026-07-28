import { describe, expect, it, vi } from "vitest";
import {
  createOpProfileChecker,
  parseOpProfileResponse
} from "../services/op-profile";

describe("parseOpProfileResponse", () => {
  it("returns the API nickname for ret 0", () => {
    expect(parseOpProfileResponse({ ret: 0, msg: "", nickname: "API昵称" }))
      .toEqual({ kind: "success", nickname: "API昵称" });
  });

  it("maps only ret -22 to invalid-openid", () => {
    expect(parseOpProfileResponse({ ret: -22, msg: "openid is invalid" }))
      .toEqual({ kind: "invalid-openid" });
  });

  it("preserves another ret message", () => {
    expect(parseOpProfileResponse({ ret: 100030, msg: "token is invalid" }))
      .toEqual({ kind: "message", message: "token is invalid" });
  });

  it("uses a stable message when another ret has no msg", () => {
    expect(parseOpProfileResponse({ ret: 1, msg: "" }))
      .toEqual({ kind: "message", message: "未知错误" });
  });

  it("treats ret 0 without a string nickname as unavailable", () => {
    expect(parseOpProfileResponse({ ret: 0, msg: "" }))
      .toEqual({ kind: "unavailable" });
  });
});

describe("createOpProfileChecker", () => {
  it("uses the first two OP segments and URL-encodes them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ret: 0, msg: "", nickname: "API昵称" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl
    });

    await expect(
      checker("open id|access+token|pay|pfkey|1782303418")
    ).resolves.toEqual({ kind: "success", nickname: "API昵称" });

    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("openid")).toBe("open id");
    expect(url.searchParams.get("access_token")).toBe("access+token");
    expect(url.searchParams.get("oauth_consumer_key")).toBe("1105602870");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call fetch when OP credentials cannot be extracted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl
    });

    await expect(checker("invalid")).resolves.toEqual({ kind: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["network", async () => { throw new TypeError("network"); }],
    ["non-json", async () => new Response("<html>", { status: 200 })],
    ["http error", async () => new Response("bad gateway", { status: 502 })]
  ])("normalizes %s failure after two attempts", async (_name, implementation) => {
    const fetchImpl = vi.fn<typeof fetch>(implementation);
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl,
      retryDelayMs: 0
    });

    await expect(checker("open|token|pay|pfkey|1782303418"))
      .resolves.toEqual({ kind: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("recovers from a timeout on the second attempt", async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((resolve, reject) => {
        calls += 1;
        if (calls === 2) {
          resolve(new Response(JSON.stringify({ ret: 0, msg: "", nickname: "API昵称" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          }));
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true }
        );
      })
    );
    const checker = createOpProfileChecker({
      baseUrl: new URL("https://graph.qq.com/user/get_simple_userinfo"),
      appId: "1105602870",
      fetchImpl,
      timeoutMs: 5,
      retryDelayMs: 0
    });

    await expect(checker("open|token|pay|pfkey|1782303418"))
      .resolves.toEqual({ kind: "success", nickname: "API昵称" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
