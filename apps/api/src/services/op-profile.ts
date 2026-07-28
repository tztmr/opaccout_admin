import { z } from "zod";

const BaseResponseSchema = z
  .object({
    ret: z.number().int(),
    msg: z.string().optional()
  })
  .passthrough();

const SuccessResponseSchema = BaseResponseSchema.extend({
  ret: z.literal(0),
  nickname: z.string()
});

export type OpProfileCheckResult =
  | { kind: "success"; nickname: string }
  | { kind: "invalid-openid" }
  | { kind: "message"; message: string }
  | { kind: "unavailable" };

export function parseOpProfileResponse(value: unknown): OpProfileCheckResult {
  const base = BaseResponseSchema.safeParse(value);
  if (!base.success) return { kind: "unavailable" };
  if (base.data.ret === 0) {
    const success = SuccessResponseSchema.safeParse(value);
    return success.success
      ? { kind: "success", nickname: success.data.nickname }
      : { kind: "unavailable" };
  }
  if (base.data.ret === -22) return { kind: "invalid-openid" };
  return {
    kind: "message",
    message: base.data.msg?.trim() || "未知错误"
  };
}

export function createOpProfileChecker({
  baseUrl,
  appId,
  fetchImpl = fetch,
  fetchResolver,
  timeoutMs = 5_000,
  maxAttempts = 2,
  retryDelayMs = 300
}: {
  baseUrl: URL;
  appId: string;
  fetchImpl?: typeof fetch;
  fetchResolver?: () => Promise<typeof fetch> | typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  return async function checkOpProfile(
    opSecret: string
  ): Promise<OpProfileCheckResult> {
    const [openid = "", accessToken = ""] = opSecret.split("|");
    if (!openid.trim() || !accessToken.trim()) return { kind: "unavailable" };

    const requestUrl = new URL(baseUrl);
    requestUrl.searchParams.set("access_token", accessToken);
    requestUrl.searchParams.set("oauth_consumer_key", appId);
    requestUrl.searchParams.set("openid", openid);

    let resolvedFetch = fetchImpl;
    if (fetchResolver) {
      try {
        resolvedFetch = await fetchResolver();
      } catch {
        resolvedFetch = fetchImpl;
      }
    }

    const attempts = Math.max(1, maxAttempts);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await resolvedFetch(requestUrl, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
          if (attempt === attempts - 1) return { kind: "unavailable" };
        } else {
          return parseOpProfileResponse(await response.json());
        }
      } catch {
        if (attempt === attempts - 1) return { kind: "unavailable" };
      }

      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    return { kind: "unavailable" };
  };
}
