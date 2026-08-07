import {
  OP_PROJECTS,
  type PublicOpResolveResponse
} from "@douyin-admin/shared";
import { AccountModel } from "../models/account";
import type { EncryptedValue } from "./encryption";
import type { SecretCipher } from "./encryption";
import type { OpProfileCheckResult } from "./op-profile";
import { isOpTokenInvalid } from "./op-profile-policy";
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
  checkOpProfile: (opSecret: string) => Promise<OpProfileCheckResult>;
  now?: () => Date;
  buildWakeUrl?: (opData: string, appId: string) => string;
};

export function createPublicOpService({
  model = AccountModel as unknown as PublicOpModel,
  cipher,
  checkOpProfile,
  now = () => new Date(),
  buildWakeUrl = buildOpWakeUrl
}: PublicOpServiceOptions): PublicOpService {
  return {
    async resolve(code) {
      const account = await model.findOne({ shortOpCode: code }).lean();
      if (!account) {
        return null;
      }

      const project = OP_PROJECTS[account.opProject as keyof typeof OP_PROJECTS];
      if (!project) return null;

      try {
        const opData = cipher.decrypt(account.opSecret);
        const profile = await checkOpProfile(opData);
        if (profile.kind === "success") {
          // QQ 侧仍可查到资料时，不以本地 90 天展示到期时间为唯一依据。
          return {
            status: "success",
            code,
            opData,
            project,
            expiresAt: account.opExpiresAt.toISOString(),
            wakeUrl: buildWakeUrl(opData, project.appId)
          };
        }

        if (
          profile.kind === "invalid-openid"
          || isOpTokenInvalid(profile)
        ) {
          return null;
        }

        // QQ 查询暂时不可用时，仅在本地仍未到展示到期且未标记 OP 失效时放行。
        if (
          account.accountStatus === "op_invalid"
          || account.opExpiresAt <= now()
        ) {
          return null;
        }

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
