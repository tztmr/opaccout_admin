import type { AccountInput } from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import type { AccountsService, AuditContext } from "./accounts";
import type { EncryptedValue, SecretCipher } from "./encryption";

type StagedRow = Omit<AccountInput, "opSecret"> & { opSecret: EncryptedValue };
export type ImportRowOutcome = "created" | "updated" | "skipped";

export async function processImportRow(
  accounts: AccountsService,
  input: AccountInput,
  duplicateStrategy: "skip" | "update",
  context: AuditContext,
  findExisting: (
    douyinId: string
  ) => Promise<{ _id: unknown } | null> = async (douyinId) =>
    AccountModel.findOne({ douyinId }).select("_id").lean()
): Promise<ImportRowOutcome> {
  const existing = await findExisting(input.douyinId);
  if (existing && duplicateStrategy === "skip") return "skipped";
  if (existing) {
    await accounts.update(String(existing._id), input, context);
    return "updated";
  }
  await accounts.create(input, context);
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
  for (const raw of preview.stagedRows as StagedRow[]) {
    const input: AccountInput = { ...raw, opSecret: cipher.decrypt(raw.opSecret) };
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
    } catch {
      job.failedCount += 1;
    }
    job.processed += 1;
    if (job.processed % 25 === 0) await job.save();
  }
  job.status = "completed";
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
