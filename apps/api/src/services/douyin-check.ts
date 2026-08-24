import type { AccountStatus } from "@douyin-admin/shared";
import { z } from "zod";

export const DEFAULT_DOUYIN_PROFILE_API_URL = new URL(
  "https://imdesktop.douyin.com/aweme/v1/web/user/profile/other/"
);
export const DEFAULT_DOUYIN_UNIQUE_ID_API_URL = new URL(
  "https://www.douyin.com/web/api/v2/user/info/"
);

const OuterResponseSchema = z.object({
  status: z.number().int(),
  body: z.string()
});

const PunishmentSchema = z
  .object({
    is_punish: z.boolean().optional(),
    ban_type: z.number().int().optional(),
    punish_title: z.string().optional(),
    prompt_bar: z
      .object({
        content: z.string().optional()
      })
      .passthrough()
      .nullish(),
    punish_content: z
      .object({
        content: z.string().optional()
      })
      .passthrough()
      .nullish()
  })
  .passthrough();

const InnerUserInfoSchema = z.object({
  sec_uid: z.string().min(1),
  is_ban: z.boolean().optional(),
  punish_remind_info: PunishmentSchema.nullish()
});

const InnerResponseSchema = z.object({
  status_code: z.number().int(),
  user_info: InnerUserInfoSchema
});

const UniqueIdResponseSchema = z.object({
  status_code: z.number().int(),
  user_info: z.object({
    sec_uid: z.string().min(1)
  })
});

const ProfileOtherResponseSchema = z.object({
  status_code: z.number().int(),
  user: InnerUserInfoSchema
});

export type DouyinCheckResult = {
  secUid: string;
  accountStatus: AccountStatus;
  checkedAt: Date;
};

export type DouyinCheckOptions = {
  secUid?: string;
  signal?: AbortSignal;
};

export class DouyinCheckError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(code);
    this.name = "DouyinCheckError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mapAccountStatus(
  isBan: boolean | undefined,
  punishment: z.infer<typeof PunishmentSchema> | null | undefined
): AccountStatus {
  const title = punishment?.punish_title?.trim() ?? "";
  const promptContent = punishment?.prompt_bar?.content?.trim() ?? "";
  const punishContent = punishment?.punish_content?.content?.trim() ?? "";
  const content = [promptContent, punishContent].filter(Boolean).join("\n");

  if (punishment?.ban_type === 1 || title === "账号已被封禁") return "banned";
  if (
    punishment?.ban_type === 2 ||
    title === "违规处罚说明" ||
    content.includes("该用户被禁止关注") ||
    Boolean(title) ||
    punishment?.is_punish === true
  ) return "violation";
  if (isBan === false || (isBan === undefined && punishment == null)) return "normal";
  return "unknown";
}

function parseJsonish(text: string): unknown {
  const normalized = text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^for\s*\(\s*;;\s*\);\s*/, "");
  if (!normalized) return null;

  const candidates = [normalized];
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(normalized.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function toCheckResult(
  user: z.infer<typeof InnerUserInfoSchema>,
  now: () => Date
): DouyinCheckResult {
  return {
    secUid: user.sec_uid,
    accountStatus: mapAccountStatus(user.is_ban, user.punish_remind_info),
    checkedAt: now()
  };
}

export function parseDouyinProfileOtherResponse(
  value: unknown,
  now: () => Date = () => new Date()
): DouyinCheckResult {
  let parsed: z.infer<typeof ProfileOtherResponseSchema>;
  try {
    parsed = ProfileOtherResponseSchema.parse(value);
  } catch {
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (parsed.status_code !== 0) {
    throw new DouyinCheckError("DOUYIN_INNER_STATUS_INVALID");
  }

  return toCheckResult(parsed.user, now);
}

export function parseDouyinResponse(
  value: unknown,
  now: () => Date = () => new Date()
): DouyinCheckResult {
  // Direct profile/other payload from imdesktop.
  if (
    value &&
    typeof value === "object" &&
    "user" in value &&
    !("body" in value)
  ) {
    return parseDouyinProfileOtherResponse(value, now);
  }

  let outer: z.infer<typeof OuterResponseSchema>;
  let innerValue: unknown;

  try {
    outer = OuterResponseSchema.parse(value);
    if (!outer.body.trim()) {
      throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID", true);
    }
    innerValue = parseJsonish(outer.body);
    if (innerValue == null) {
      throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID", true);
    }
  } catch (error) {
    if (error instanceof DouyinCheckError) throw error;
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (outer.status !== 200) {
    throw new DouyinCheckError(
      "DOUYIN_OUTER_STATUS_INVALID",
      outer.status >= 500
    );
  }

  // Some proxies may wrap profile/other JSON in the outer body string.
  if (
    innerValue &&
    typeof innerValue === "object" &&
    "user" in innerValue &&
    !("user_info" in innerValue)
  ) {
    return parseDouyinProfileOtherResponse(innerValue, now);
  }

  let inner: z.infer<typeof InnerResponseSchema>;
  try {
    inner = InnerResponseSchema.parse(innerValue);
  } catch {
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (inner.status_code !== 0) {
    throw new DouyinCheckError("DOUYIN_INNER_STATUS_INVALID");
  }

  return toCheckResult(inner.user_info, now);
}

export function parseDouyinUniqueIdResponse(value: unknown): string {
  let parsed: z.infer<typeof UniqueIdResponseSchema>;
  try {
    parsed = UniqueIdResponseSchema.parse(value);
  } catch {
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (parsed.status_code !== 0) {
    throw new DouyinCheckError("DOUYIN_INNER_STATUS_INVALID");
  }
  return parsed.user_info.sec_uid;
}

type DouyinCheckerOptions = {
  baseUrl: URL;
  uniqueIdUrl?: URL;
  profileUrl?: URL;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  random?: () => number;
};

function buildProfileOtherUrl(profileUrl: URL, secUid: string): URL {
  const requestUrl = new URL(profileUrl.href);
  if (!requestUrl.searchParams.has("aid")) {
    requestUrl.searchParams.set("aid", "339757");
  }
  if (!requestUrl.searchParams.has("device_id")) {
    requestUrl.searchParams.set("device_id", "7184690798967999755");
  }
  if (!requestUrl.searchParams.has("version_name")) {
    requestUrl.searchParams.set("version_name", "1.0.0");
  }
  if (!requestUrl.searchParams.has("device_platform")) {
    requestUrl.searchParams.set("device_platform", "win32");
  }
  requestUrl.searchParams.set("sec_user_id", secUid);
  return requestUrl;
}

function randomInteger(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function buildRandomDouyinWebHeaders(
  random: () => number
): Record<string, string> {
  const operatingSystems = [
    "Macintosh; Intel Mac OS X 10_15_7",
    "Windows NT 10.0; Win64; x64",
    "X11; Linux x86_64"
  ];
  const operatingSystem =
    operatingSystems[randomInteger(random, 0, operatingSystems.length - 1)];
  const chromeMajor = randomInteger(random, 120, 131);
  const ttwid = Array.from({ length: 4 }, () =>
    random().toString(36).slice(2)
  ).join("");

  return {
    accept: "*/*",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    connection: "keep-alive",
    cookie: `ttwid=${ttwid}`,
    referer: "https://www.douyin.com",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": `Mozilla/5.0 (${operatingSystem}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
  };
}

function buildUniqueIdUrl(uniqueIdUrl: URL, douyinId: string): URL {
  const requestUrl = new URL(uniqueIdUrl.href);
  requestUrl.searchParams.set("sec_uid", "");
  requestUrl.searchParams.set("unique_id", douyinId);
  return requestUrl;
}

export function createDouyinChecker({
  baseUrl,
  uniqueIdUrl = DEFAULT_DOUYIN_UNIQUE_ID_API_URL,
  profileUrl = DEFAULT_DOUYIN_PROFILE_API_URL,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  maxAttempts = 3,
  retryDelayMs = 400,
  random = Math.random
}: DouyinCheckerOptions) {
  async function requestJson(
    requestUrl: URL,
    callerSignal?: AbortSignal,
    requestHeaderFactory?: () => Record<string, string>
  ): Promise<unknown> {
    let lastRetryableError: DouyinCheckError | undefined;
    const attempts = Math.max(1, maxAttempts);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, timeoutSignal])
        : timeoutSignal;

      try {
        const response = await fetchImpl(requestUrl, {
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            ...(requestHeaderFactory?.() ?? {})
          },
          signal
        });

        if (response.status >= 500) {
          throw new DouyinCheckError("DOUYIN_UPSTREAM_UNAVAILABLE", true);
        }
        if (!response.ok) {
          throw new DouyinCheckError("DOUYIN_UPSTREAM_REJECTED");
        }

        try {
          return await response.json();
        } catch {
          throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID", true);
        }
      } catch (error) {
        const normalized =
          error instanceof DouyinCheckError
            ? error
            : new DouyinCheckError(
                error instanceof DOMException &&
                (error.name === "AbortError" || error.name === "TimeoutError")
                  ? "DOUYIN_TIMEOUT"
                  : "DOUYIN_NETWORK_ERROR",
                true
              );

        if (!normalized.retryable || attempt === attempts - 1) throw normalized;
        lastRetryableError = normalized;
        if (retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs * (attempt + 1))
          );
        }
      }
    }

    throw (
      lastRetryableError ?? new DouyinCheckError("DOUYIN_NETWORK_ERROR", true)
    );
  }

  async function requestOfficialByNum(
    num: string,
    callerSignal?: AbortSignal
  ): Promise<string> {
    const requestUrl = buildUniqueIdUrl(uniqueIdUrl, num);
    return parseDouyinUniqueIdResponse(
      await requestJson(
        requestUrl,
        callerSignal,
        () => buildRandomDouyinWebHeaders(random)
      )
    );
  }

  async function requestThirdPartyByNum(
    num: string,
    callerSignal?: AbortSignal
  ): Promise<DouyinCheckResult> {
    const requestUrl = new URL(baseUrl);
    requestUrl.searchParams.set("num", num);
    return parseDouyinResponse(await requestJson(requestUrl, callerSignal), now);
  }

  async function requestBySecUid(
    secUid: string,
    callerSignal?: AbortSignal
  ): Promise<DouyinCheckResult> {
    const requestUrl = buildProfileOtherUrl(profileUrl, secUid);
    const payload = await requestJson(requestUrl, callerSignal);
    const result = parseDouyinResponse(payload, now);
    return {
      ...result,
      secUid: result.secUid || secUid
    };
  }

  return async function checkDouyinId(
    douyinId: string,
    options: DouyinCheckOptions | AbortSignal = {}
  ): Promise<DouyinCheckResult> {
    const normalizedOptions =
      options instanceof AbortSignal ? { signal: options } : options;
    const callerSignal = normalizedOptions.signal;
    const existingSecUid = normalizedOptions.secUid?.trim() || "";

    // Recheck path: prefer imdesktop profile/other when sec_uid is already known.
    if (existingSecUid) {
      try {
        return await requestBySecUid(existingSecUid, callerSignal);
      } catch (profileError) {
        // Recover through Douyin directly before using the slower third-party fallback.
        let resolvedSecUid = existingSecUid;
        try {
          resolvedSecUid = await requestOfficialByNum(douyinId, callerSignal);
        } catch {
          // Continue to the status-capable third-party fallback.
        }

        try {
          const byNum = await requestThirdPartyByNum(douyinId, callerSignal);
          return {
            ...byNum,
            secUid: byNum.secUid || resolvedSecUid
          };
        } catch {
          throw profileError;
        }
      }
    }

    // Resolve sec_uid directly from Douyin before considering the slower third party.
    let resolvedSecUid: string;
    try {
      resolvedSecUid = await requestOfficialByNum(douyinId, callerSignal);
    } catch (primaryError) {
      try {
        return await requestThirdPartyByNum(douyinId, callerSignal);
      } catch {
        throw primaryError;
      }
    }

    try {
      const rechecked = await requestBySecUid(resolvedSecUid, callerSignal);
      return {
        ...rechecked,
        secUid: rechecked.secUid || resolvedSecUid,
        checkedAt: now()
      };
    } catch (profileError) {
      try {
        const fallback = await requestThirdPartyByNum(douyinId, callerSignal);
        return {
          ...fallback,
          secUid: fallback.secUid || resolvedSecUid
        };
      } catch {
        throw profileError;
      }
    }
  };
}
