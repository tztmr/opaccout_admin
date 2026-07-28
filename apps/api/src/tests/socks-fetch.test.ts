import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { describe, expect, it } from "vitest";
import { createSocksFetch, parseSocksProxyPool } from "../services/socks-fetch";

describe("parseSocksProxyPool", () => {
  it("parses single bare proxies and authenticated pools", () => {
    expect(
      parseSocksProxyPool(
        [
          "198.64.244.205:50101:tztright:t5sYiBK8tD",
          "127.0.0.1:1081",
          "user:pass@10.0.0.2:9000",
          "socks5://127.0.0.1:1082"
        ].join("\n")
      ).map((item) => item.href)
    ).toEqual([
      "socks5://tztright:t5sYiBK8tD@198.64.244.205:50101",
      "socks5://127.0.0.1:1081",
      "socks5://user:pass@10.0.0.2:9000",
      "socks5://127.0.0.1:1082"
    ]);
  });
});

describe("createSocksFetch", () => {
  it("uses the configured proxy and returns the upstream response", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    let capturedProxy = "";
    const fetchImpl = createSocksFetch([new URL("socks5://127.0.0.1:1080")], {
      createAgent: (proxyUrl) => {
        capturedProxy = proxyUrl.href;
        return { proxyUrl: proxyUrl.href } as unknown as RequestOptions["agent"];
      },
      httpsRequest: (
        _url: URL,
        options: RequestOptions,
        callback: (response: IncomingMessage) => void
      ) => {
        capturedOptions = options as Record<string, unknown>;
        const response = new PassThrough() as PassThrough &
          Partial<IncomingMessage>;
        response.statusCode = 200;
        response.headers = { "content-type": "application/json" };
        callback(response as IncomingMessage);
        queueMicrotask(() => {
          response.end(JSON.stringify({ ret: 0, nickname: "代理昵称" }));
        });
        return {
          on() {
            return this;
          },
          end() {}
        } as unknown as ClientRequest;
      }
    });

    const response = await fetchImpl("https://graph.qq.com/user/get_simple_userinfo", {
      headers: { accept: "application/json" }
    });

    expect(capturedProxy).toBe("socks5://127.0.0.1:1080");
    expect(capturedOptions?.agent).toEqual({ proxyUrl: "socks5://127.0.0.1:1080" });
    await expect(response.json()).resolves.toEqual({
      ret: 0,
      nickname: "代理昵称"
    });
  });

  it("falls back to the next proxy when the first one fails", async () => {
    const attempts: string[] = [];
    let calls = 0;
    const fetchImpl = createSocksFetch(
      [
        new URL("socks5://127.0.0.1:1080"),
        new URL("socks5://127.0.0.1:1081")
      ],
      {
        createAgent: (proxyUrl) =>
          ({ proxyUrl: proxyUrl.href } as unknown as RequestOptions["agent"]),
        httpsRequest: (
          _url: URL,
          options: RequestOptions,
          callback: (response: IncomingMessage) => void
        ) => {
          calls += 1;
          attempts.push(
            String((options.agent as { proxyUrl?: string } | undefined)?.proxyUrl)
          );

          if (calls === 1) {
            return {
              on(event: string, handler: unknown) {
                if (event === "error") {
                  queueMicrotask(() =>
                    (handler as (error: Error) => void)(new Error("proxy down"))
                  );
                }
                return this;
              },
              end() {}
            } as unknown as ClientRequest;
          }

          const response = new PassThrough() as PassThrough & Partial<IncomingMessage>;
          response.statusCode = 200;
          response.headers = { "content-type": "application/json" };
          callback(response as IncomingMessage);
          queueMicrotask(() => {
            response.end(JSON.stringify({ ret: 0, nickname: "切换成功" }));
          });
          return {
            on() {
              return this;
            },
            end() {}
          } as unknown as ClientRequest;
        }
      }
    );

    const response = await fetchImpl("https://graph.qq.com/user/get_simple_userinfo");

    expect(attempts).toEqual([
      "socks5://127.0.0.1:1080",
      "socks5://127.0.0.1:1081"
    ]);
    await expect(response.json()).resolves.toEqual({
      ret: 0,
      nickname: "切换成功"
    });
  });

  it("rotates the starting proxy across requests", async () => {
    const starts: string[] = [];
    const fetchImpl = createSocksFetch(
      [
        new URL("socks5://127.0.0.1:1080"),
        new URL("socks5://127.0.0.1:1081")
      ],
      {
        createAgent: (proxyUrl: URL) =>
          ({ proxyUrl: proxyUrl.href } as unknown as RequestOptions["agent"]),
        httpsRequest: (
          _url: URL,
          options: RequestOptions,
          callback: (response: IncomingMessage) => void
        ) => {
          starts.push(
            String((options.agent as { proxyUrl?: string } | undefined)?.proxyUrl)
          );
          const response = new PassThrough() as PassThrough & Partial<IncomingMessage>;
          response.statusCode = 200;
          response.headers = { "content-type": "application/json" };
          callback(response as IncomingMessage);
          queueMicrotask(() => {
            response.end(JSON.stringify({ ret: 0, nickname: "轮询成功" }));
          });
          return {
            on() {
              return this;
            },
            end() {}
          } as unknown as ClientRequest;
        }
      }
    );

    await fetchImpl("https://graph.qq.com/user/get_simple_userinfo");
    await fetchImpl("https://graph.qq.com/user/get_simple_userinfo");

    expect(starts).toEqual([
      "socks5://127.0.0.1:1080",
      "socks5://127.0.0.1:1081"
    ]);
  });
});
