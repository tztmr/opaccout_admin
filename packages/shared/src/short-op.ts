import { z } from "zod";

export const ShortOpCodeSchema = z.string().regex(/^[1-9][0-9]{8}$/);

export const OP_PROJECTS = {
  douyin: { key: "douyin", name: "抖音", appId: "1105602870" }
} as const;

export const OpProjectSchema = z.enum(["douyin"]);
export const DEFAULT_OP_PROJECT = "douyin" as const;

export const PUBLIC_OP_ORIGIN = "https://op.tztright.qzz.io";
export const PUBLIC_OP_API_URL = `${PUBLIC_OP_ORIGIN}/api/op/resolve`;

export const PublicOpResolveRequestSchema = z.object({
  code: ShortOpCodeSchema
}).strict();

export type PublicOpResolveResponse = {
  status: "success";
  code: string;
  opData: string;
  project: (typeof OP_PROJECTS)[keyof typeof OP_PROJECTS];
  expiresAt: string;
  wakeUrl: string;
};
