import type { AccountInput } from "@douyin-admin/shared";
import type { OpProfileCheckResult } from "./op-profile";

const MAX_OP_NAME_LENGTH = 100;
const MAX_REMARK_LENGTH = 1000;
const REMARK_SEPARATOR = " | ";

function appendOpRemark(remark: string, message: string): string {
  if (!remark) return `OP: ${message}`.slice(0, MAX_REMARK_LENGTH);
  const note = `OP: ${message}`.slice(
    0,
    MAX_REMARK_LENGTH - REMARK_SEPARATOR.length - 1
  );
  const originalLength = Math.max(
    1,
    MAX_REMARK_LENGTH - REMARK_SEPARATOR.length - note.length
  );
  return `${remark.slice(0, originalLength)}${REMARK_SEPARATOR}${note}`;
}

export function applyOpProfileResult(
  input: AccountInput,
  result: OpProfileCheckResult
): AccountInput {
  if (result.kind === "success") {
    return {
      ...input,
      opName: result.nickname.trim().slice(0, MAX_OP_NAME_LENGTH)
    };
  }
  if (result.kind === "invalid-openid") {
    return { ...input, saleStatus: "disabled" };
  }
  return {
    ...input,
    remark: appendOpRemark(
      input.remark,
      result.kind === "message" ? result.message : "查询失败"
    )
  };
}
