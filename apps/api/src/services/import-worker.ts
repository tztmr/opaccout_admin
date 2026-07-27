import type { AccountInput } from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import { ImportJobModel } from "../models/import-job";
import { ImportPreviewModel } from "../models/import-preview";
import type { AccountsService } from "./accounts";
import type { EncryptedValue, SecretCipher } from "./encryption";

type StagedRow = Omit<AccountInput, "opSecret"> & { opSecret: EncryptedValue };

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
      await accounts.create(input, context);
      job.createdCount += 1;
    } catch (error) {
      const code = error instanceof Error ? error.message : "IMPORT_ROW_FAILED";
      if (job.duplicateStrategy === "update" && (code.includes("已存在") || code.includes("DUPLICATE"))) {
        const existing = await AccountModel.findOne({ douyinId: input.douyinId }).select("_id").lean();
        if (existing) {
          await accounts.update(String(existing._id), input, context);
          job.updatedCount += 1;
        } else {
          job.failedCount += 1;
        }
      } else if (job.duplicateStrategy === "skip" && (code.includes("已存在") || code.includes("DUPLICATE"))) {
        job.skippedCount += 1;
      } else {
        job.failedCount += 1;
      }
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
