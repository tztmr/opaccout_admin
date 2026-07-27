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
  timeoutMs = 5_000
}: {
  baseUrl: URL;
  appId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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

    try {
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) return { kind: "unavailable" };
      return parseOpProfileResponse(await response.json());
    } catch {
      return { kind: "unavailable" };
    }
  };
}
