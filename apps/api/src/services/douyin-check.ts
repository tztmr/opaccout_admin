import type { AccountStatus } from "@douyin-admin/shared";
import { z } from "zod";

const OuterResponseSchema = z.object({
  status: z.number().int(),
  body: z.string()
});

const PunishmentSchema = z
  .object({
    is_punish: z.boolean().optional(),
    ban_type: z.number().int().optional(),
    punish_title: z.string().optional()
    ,
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

const InnerResponseSchema = z.object({
  status_code: z.number().int(),
  user_info: z.object({
    sec_uid: z.string().min(1),
    is_ban: z.boolean().optional(),
    punish_remind_info: PunishmentSchema.nullish()
  })
});

export type DouyinCheckResult = {
  secUid: string;
  accountStatus: AccountStatus;
  checkedAt: Date;
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

  if (title === "账号已被封禁") return "banned";
  if (punishment?.is_punish && punishment.ban_type === 1) return "banned";
  // profile/other: punish_title=违规处罚说明, content=该用户被禁止关注 => 违规
  if (title === "违规处罚说明" || content.includes("该用户被禁止关注")) {
    return "violation";
  }
  if (punishment?.is_punish && punishment.ban_type === 2) return "violation";
  if (title) return "violation";
  if (punishment?.is_punish) return "violation";
  if (isBan === true) return "violation";
  return "normal";
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

export function parseDouyinResponse(
  value: unknown,
  now: () => Date = () => new Date()
): DouyinCheckResult {
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

  let inner: z.infer<typeof InnerResponseSchema>;
  try {
    inner = InnerResponseSchema.parse(innerValue);
  } catch {
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (inner.status_code !== 0) {
    throw new DouyinCheckError("DOUYIN_INNER_STATUS_INVALID");
  }

  return {
    secUid: inner.user_info.sec_uid,
    accountStatus: mapAccountStatus(
      inner.user_info.is_ban,
      inner.user_info.punish_remind_info
    ),
    checkedAt: now()
  };
}

type DouyinCheckerOptions = {
  baseUrl: URL;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export function createDouyinChecker({
  baseUrl,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  maxAttempts = 3,
  retryDelayMs = 400
}: DouyinCheckerOptions) {
  async function requestCheck(
    params: { num?: string; secUid?: string },
    callerSignal?: AbortSignal
  ): Promise<DouyinCheckResult> {
    const requestUrl = new URL(baseUrl);
    if (params.num) requestUrl.searchParams.set("num", params.num);
    if (params.secUid) requestUrl.searchParams.set("sec_uid", params.secUid);

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
          headers: { accept: "application/json" },
          signal
        });

        if (response.status >= 500) {
          throw new DouyinCheckError("DOUYIN_UPSTREAM_UNAVAILABLE", true);
        }
        if (!response.ok) {
          throw new DouyinCheckError("DOUYIN_UPSTREAM_REJECTED");
        }

        let responseValue: unknown;
        try {
          responseValue = await response.json();
        } catch {
          throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID", true);
        }

        return parseDouyinResponse(responseValue, now);
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

  return async function checkDouyinId(
    douyinId: string,
    callerSignal?: AbortSignal
  ): Promise<DouyinCheckResult> {
    // Primary path: check by Douyin unique_id (num) only.
    try {
      return await requestCheck({ num: douyinId }, callerSignal);
    } catch (primaryError) {
      // Fallback (check_tktok_num style): recover sec_uid via num, then recheck by sec_uid.
      let resolved: DouyinCheckResult;
      try {
        resolved = await requestCheck({ num: douyinId }, callerSignal);
      } catch {
        throw primaryError;
      }

      if (!resolved.secUid) return resolved;

      try {
        const rechecked = await requestCheck(
          { secUid: resolved.secUid },
          callerSignal
        );
        return {
          ...rechecked,
          secUid: rechecked.secUid || resolved.secUid,
          checkedAt: now()
        };
      } catch {
        return resolved;
      }
    }
  };
}
