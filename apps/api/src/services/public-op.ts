import {
  OP_PROJECTS,
  type PublicOpResolveResponse
} from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import type { EncryptedValue } from "./encryption";
import type { SecretCipher } from "./encryption";
import { buildOpWakeUrl } from "./op-wake-url";

type PublicOpRecord = {
  shortOpCode?: string;
  opExpiresAt: Date;
  accountStatus: string;
  opSecret: EncryptedValue;
  opProject?: string;
};

type PublicOpModel = {
  findOne(filter: { shortOpCode: string }): {
    lean(): Promise<PublicOpRecord | null>;
  };
};

export type PublicOpService = {
  resolve(code: string): Promise<PublicOpResolveResponse | null>;
};

export type PublicOpServiceOptions = {
  model?: PublicOpModel;
  cipher: SecretCipher;
  now?: () => Date;
  buildWakeUrl?: (opData: string, appId: string) => string;
};

export function createPublicOpService({
  model = AccountModel as unknown as PublicOpModel,
  cipher,
  now = () => new Date(),
  buildWakeUrl = buildOpWakeUrl
}: PublicOpServiceOptions): PublicOpService {
  return {
    async resolve(code) {
      const account = await model.findOne({ shortOpCode: code }).lean();
      if (
        !account
        || account.opExpiresAt <= now()
        || account.accountStatus === "op_invalid"
      ) {
        return null;
      }

      const project = OP_PROJECTS[account.opProject as keyof typeof OP_PROJECTS];
      if (!project) return null;

      try {
        const opData = cipher.decrypt(account.opSecret);
        return {
          status: "success",
          code,
          opData,
          project,
          expiresAt: account.opExpiresAt.toISOString(),
          wakeUrl: buildWakeUrl(opData, project.appId)
        };
      } catch {
        return null;
      }
    }
  };
}
