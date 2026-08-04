import { createServer } from "node:http";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { ImportJobModel } from "./models/import-job";
import { AccountModel } from "./models/account";
import { auditService } from "./services/audit";
import { createAccountsService } from "./services/accounts";
import { createAdminAuthService } from "./services/admin-auth";
import { createMongooseAdminRepository } from "./services/admin-repository";
import { createDouyinChecker } from "./services/douyin-check";
import { createSecretCipher } from "./services/encryption";
import { startImportWorker } from "./services/import-worker";
import { SettingModel } from "./models/setting";
import { createOpProfileChecker } from "./services/op-profile";
import { parseSocksProxyPool } from "./services/socks-fetch";
import { createSocksFetch } from "./services/socks-fetch";
import { normalizeBannedSaleStatuses } from "./services/sale-status-policy";
import { backfillMissingShortOps } from "./services/short-op-code";
import { createPublicOpService } from "./services/public-op";

async function main() {
  const config = loadConfig(process.env);
  await mongoose.connect(config.mongoUri);
  await AccountModel.syncIndexes();
  await backfillMissingShortOps(AccountModel);
  await normalizeBannedSaleStatuses();
  await ImportJobModel.updateMany(
    { status: "running" },
    { $set: { status: "queued" }, $unset: { startedAt: 1 } }
  );
  const cipher = createSecretCipher(config.fieldEncryptionKey);
  const publicOpService = createPublicOpService({ cipher });
  const checkDouyinId = createDouyinChecker({ baseUrl: config.douyinCheckApiUrl });
  const checkOpProfile = createOpProfileChecker({
    baseUrl: config.qqOpProfileApiUrl,
    appId: config.qqOpAppId,
    fetchResolver: async () => {
      try {
        const settings = await SettingModel.findOne({ key: "admin" }).lean();
        const storedPool = settings?.qqOpSocksProxyPool?.trim()
          ? parseSocksProxyPool(settings.qqOpSocksProxyPool)
          : config.qqOpSocksProxyUrls;
        return storedPool.length ? createSocksFetch(storedPool) : fetch;
      } catch {
        return config.qqOpSocksProxyUrls.length
          ? createSocksFetch(config.qqOpSocksProxyUrls)
          : fetch;
      }
    },
    timeoutMs: config.qqOpProfileTimeoutMs
  });
  const accounts = createAccountsService({
    checkDouyinId,
    checkOpProfile,
    cipher,
    audit: auditService
  });
  const adminAuth = createAdminAuthService(createMongooseAdminRepository());
  const sessionStore = MongoStore.create({
    mongoUrl: config.mongoUri,
    collectionName: "sessions",
    ttl: config.sessionHours * 60 * 60
  });
  const app = createApp({
    config,
    adminAuth,
    sessionStore,
    accountService: accounts,
    cipher,
    publicOpService,
    audit: auditService,
    isReady: () => mongoose.connection.readyState === 1
  });
  const server = createServer(app);
  const stopWorker = startImportWorker(accounts, cipher);

  await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
  process.stdout.write(`API listening on ${config.port}\n`);

  const shutdown = async () => {
    stopWorker();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    await mongoose.disconnect();
  };
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error) => {
  process.stderr.write(`API startup failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exit(1);
});
