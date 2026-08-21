import type { AccountInput, AccountKind } from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import { ImportJobModel, type ImportRowFailure } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import { AppError } from "../middleware/errors";
import type { AccountsService, AuditContext } from "./accounts";
import { DouyinCheckError } from "./douyin-check";
import type { EncryptedValue, SecretCipher } from "./encryption";
import { resolveAccountKind } from "./account-kind";

type StagedRow = Omit<AccountInput, "opSecret" | "accountPassword"> & {
  opSecret: EncryptedValue;
  accountPassword?: EncryptedValue | string | undefined;
};
export type ImportRowOutcome = "created" | "updated" | "skipped";

const DOUYIN_ERROR_MESSAGES: Record<string, string> = {
  DOUYIN_TIMEOUT: "抖音检测超时",
  DOUYIN_NETWORK_ERROR: "抖音检测网络异常",
  DOUYIN_UPSTREAM_UNAVAILABLE: "抖音检测服务不可用",
  DOUYIN_UPSTREAM_REJECTED: "抖音检测被拒绝",
  DOUYIN_RESPONSE_INVALID: "抖音检测响应无效",
  DOUYIN_OUTER_STATUS_INVALID: "抖音检测外层状态异常",
  DOUYIN_INNER_STATUS_INVALID: "抖音检测内层状态异常",
  DOUYIN_STATUS_UNKNOWN: "抖音账号状态未知",
  DOUYIN_ID_INVALID: "抖音号格式不正确",
  DOUYIN_ID_DUPLICATE: "抖音号已存在",
  SEC_UID_DUPLICATE: "sec_uid 已存在"
};

const MAX_STORED_FAILURES = 100;
const IMPORT_ROW_GAP_MS = 250;

export function classifyImportError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof DouyinCheckError) {
    return {
      code: error.code,
      message: DOUYIN_ERROR_MESSAGES[error.code] ?? "抖音检测失败"
    };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: DOUYIN_ERROR_MESSAGES[error.code] ?? error.message
    };
  }
  return {
    code: "IMPORT_ROW_FAILED",
    message: "导入失败"
  };
}

export function summarizeImportErrors(failures: ImportRowFailure[]): string {
  if (!failures.length) return "";
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.message, (counts.get(failure.message) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([message, count]) => `${message}×${count}`);
  return `失败 ${failures.length} 条：${parts.join("、")}`.slice(0, 1000);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableImportError(error: unknown): boolean {
  return error instanceof DouyinCheckError && error.retryable;
}

async function runImportAttempt<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isRetryableImportError(error)) throw error;
  }
  return action();
}

async function ensureImportedOpName(
  accounts: AccountsService,
  id: string,
  opName: string,
  context: AuditContext
): Promise<void> {
  if (opName.trim()) return;
  await accounts.update(id, { opName: "-未知-" }, context);
}

export async function processImportRow(
  accounts: AccountsService,
  input: AccountInput,
  duplicateStrategy: "skip" | "update",
  context: AuditContext,
  findExisting: (
    douyinId: string
  ) => Promise<{ _id: unknown; accountKind?: AccountKind } | null> = async (douyinId) =>
    AccountModel.findOne({ douyinId }).select("_id accountKind").lean()
): Promise<ImportRowOutcome> {
  const existing = await findExisting(input.douyinId);
  if (existing) {
    if (resolveAccountKind(existing.accountKind) !== resolveAccountKind(input.accountKind)) {
      throw new AppError(409, "DOUYIN_ID_DUPLICATE", "抖音号已存在");
    }
    if (duplicateStrategy === "skip") return "skipped";
    const id = String(existing._id);
    const { accountKind: _accountKind, ...patch } = input;
    await runImportAttempt(() => accounts.update(id, patch, context));
    const rechecked = await runImportAttempt(() => accounts.recheck(id, context));
    if (rechecked.accountStatus === "banned") {
      await ensureImportedOpName(accounts, id, rechecked.opName, context);
      return "updated";
    }
    const opChecked = await accounts.recheckOp(id, context);
    await ensureImportedOpName(accounts, id, opChecked.opName, context);
    return "updated";
  }
  const created = await runImportAttempt(() => accounts.create(input, context));
  await ensureImportedOpName(accounts, created._id, created.opName, context);
  return "created";
}

export async function processNextImportJob(
  accounts: AccountsService,
  cipher: SecretCipher
): Promise<boolean> {
  const job = await ImportJobModel.findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "running", startedAt: new Date() } },
    { new: true, sort: { createdAt: 1 } }
  );
  if (!job) return false;
  const preview = await ImportPreviewModel.findById(job.previewId);
  if (!preview) {
    job.status = "failed";
    job.errorSummary = "IMPORT_PREVIEW_EXPIRED";
    job.completedAt = new Date();
    await job.save();
    return true;
  }

  const context = { ip: "system", userAgent: "import-worker", requestId: `import-${job.id}` };
  const failures: ImportRowFailure[] = [];
  const stagedRows = preview.stagedRows as StagedRow[];
  const accountKind = preview.accountKind ?? job.accountKind ?? "google";
  for (let index = 0; index < stagedRows.length; index += 1) {
    const raw = stagedRows[index]!;
    const rowNumber = index + 2;
    const input: AccountInput = {
      ...raw,
      accountKind,
      email: accountKind === "email" ? raw.email ?? "" : "",
      opSecret: cipher.decrypt(raw.opSecret),
      accountPassword: typeof raw.accountPassword === "string"
        ? raw.accountPassword
        : raw.accountPassword
          ? cipher.decrypt(raw.accountPassword)
          : ""
    };
    try {
      const outcome = await processImportRow(
        accounts,
        input,
        job.duplicateStrategy,
        context
      );
      if (outcome === "created") job.createdCount += 1;
      if (outcome === "updated") job.updatedCount += 1;
      if (outcome === "skipped") job.skippedCount += 1;
    } catch (error) {
      job.failedCount += 1;
      const classified = classifyImportError(error);
      if (failures.length < MAX_STORED_FAILURES) {
        failures.push({
          row: rowNumber,
          douyinId: input.douyinId,
          code: classified.code,
          message: classified.message
        });
      }
    }
    job.processed += 1;
    if (job.processed % 25 === 0) {
      job.failures = failures;
      job.errorSummary = summarizeImportErrors(failures);
      await job.save();
    }
    if (index < stagedRows.length - 1) {
      await wait(IMPORT_ROW_GAP_MS);
    }
  }
  job.status = "completed";
  job.failures = failures;
  if (failures.length) {
    job.errorSummary = summarizeImportErrors(failures);
  } else {
    job.set("errorSummary", undefined);
  }
  job.completedAt = new Date();
  await job.save();
  await ImportPreviewModel.findByIdAndDelete(preview._id);
  return true;
}

export function startImportWorker(accounts: AccountsService, cipher: SecretCipher) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      while (await processNextImportJob(accounts, cipher)) {
        if (stopped) return;
      }
    } finally {
      if (!stopped) timer = setTimeout(tick, 1_000);
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
