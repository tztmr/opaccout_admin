import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";

type RequestCallback = (response: IncomingMessage) => void;
type RequestLike = (
  url: URL,
  options: RequestOptions,
  callback: RequestCallback
) => ClientRequest;

function normalizeResponseHeaders(
  headers: IncomingMessage["headers"]
): Array<[string, string]> {
  const values: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") values.push([key, value]);
    else if (Array.isArray(value)) {
      for (const item of value) values.push([key, item]);
    }
  }
  return values;
}

function parseBareProxyEntry(entry: string): URL {
  if (entry.includes("@")) {
    const url = new URL(`socks5://${entry}`);
    if (!url.hostname || !url.port) throw new Error("missing host or port");
    return url;
  }

  const parts = entry.split(":");
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !port) throw new Error("missing host or port");
    return new URL(`socks5://${host}:${port}`);
  }

  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts;
    const password = passwordParts.join(":");
    if (!host || !port || !username || !password) {
      throw new Error("missing authenticated proxy fields");
    }
    const url = new URL(`socks5://${host}:${port}`);
    url.username = username;
    url.password = password;
    return url;
  }

  throw new Error("unsupported bare proxy format");
}

function parseProxyEntry(entry: string): URL {
  if (entry.includes("://")) {
    const url = new URL(entry);
    if (!url.protocol.startsWith("socks")) {
      throw new Error("proxy must use a SOCKS protocol");
    }
    return url;
  }

  return parseBareProxyEntry(entry);
}

export function parseSocksProxyPool(value?: string): URL[] {
  if (!value?.trim()) return [];

  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseProxyEntry);
}

async function performRequest(
  requestImpl: RequestLike,
  agent: RequestOptions["agent"],
  url: URL,
  init: RequestInit
): Promise<Response> {
  const headers = new Headers(init.headers);

  return await new Promise<Response>((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        agent
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              headers: normalizeResponseHeaders(response.headers)
            })
          );
        });
        response.on("error", reject);
      }
    );

    const abortRequest = () => {
      request.destroy(
        init.signal?.reason instanceof Error
          ? init.signal.reason
          : new Error("The request was aborted")
      );
    };

    if (init.signal) {
      if (init.signal.aborted) {
        abortRequest();
        return;
      }
      init.signal.addEventListener("abort", abortRequest, { once: true });
    }

    request.on("error", reject);
    request.end();
  });
}

export function createSocksFetch(
  proxyUrls: URL[],
  deps: {
    httpsRequest?: RequestLike;
    createAgent?: (proxyUrl: URL) => RequestOptions["agent"];
  } = {}
): typeof fetch {
  if (!proxyUrls.length) {
    throw new Error("At least one SOCKS proxy URL is required");
  }

  const requestImpl = deps.httpsRequest ?? httpsRequest;
  const createAgent = deps.createAgent ?? ((proxyUrl: URL) => new SocksProxyAgent(proxyUrl.href));
  let nextProxyIndex = 0;

  return async function socksFetch(input, init = {}) {
    const url = new URL(String(input));
    const startIndex = nextProxyIndex;
    nextProxyIndex = (nextProxyIndex + 1) % proxyUrls.length;

    let lastError: unknown;
    for (let attempt = 0; attempt < proxyUrls.length; attempt += 1) {
      const proxyUrl = proxyUrls[(startIndex + attempt) % proxyUrls.length];
      if (!proxyUrl) continue;
      try {
        return await performRequest(requestImpl, createAgent(proxyUrl), url, init);
      } catch (error) {
        lastError = error;
        if (init.signal?.aborted) break;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("All SOCKS proxies failed");
  };
}
