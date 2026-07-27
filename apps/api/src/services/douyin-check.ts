import type { AccountStatus } from "@douyin-admin/shared";
import { z } from "zod";

const OuterResponseSchema = z.object({
  status: z.number().int(),
  body: z.string()
});

const PunishmentSchema = z
  .object({
    is_punish: z.boolean(),
    ban_type: z.number().int()
  })
  .passthrough();

const InnerResponseSchema = z.object({
  status_code: z.number().int(),
  user_info: z.object({
    sec_uid: z.string().min(1),
    is_ban: z.boolean(),
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
  isBan: boolean,
  punishment: z.infer<typeof PunishmentSchema> | null | undefined
): AccountStatus {
  if (punishment?.is_punish && punishment.ban_type === 1) return "banned";
  if (punishment?.is_punish && punishment.ban_type === 2) return "violation";
  if (!punishment?.is_punish && !isBan) return "normal";
  throw new DouyinCheckError("DOUYIN_STATUS_UNKNOWN");
}

export function parseDouyinResponse(
  value: unknown,
  now: () => Date = () => new Date()
): DouyinCheckResult {
  let outer: z.infer<typeof OuterResponseSchema>;
  let innerValue: unknown;

  try {
    outer = OuterResponseSchema.parse(value);
    innerValue = JSON.parse(outer.body);
  } catch {
    throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
  }

  if (outer.status !== 200) {
    throw new DouyinCheckError("DOUYIN_OUTER_STATUS_INVALID");
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
  return async function checkDouyinId(
    douyinId: string,
    callerSignal?: AbortSignal
  ): Promise<DouyinCheckResult> {
    const requestUrl = new URL(baseUrl);
    requestUrl.searchParams.set("num", douyinId);
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
          throw new DouyinCheckError("DOUYIN_RESPONSE_INVALID");
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
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
      }
    }

    throw lastRetryableError ?? new DouyinCheckError("DOUYIN_NETWORK_ERROR", true);
  };
}
