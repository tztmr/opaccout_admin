import {
  ACCOUNT_STATUSES,
  ACCOUNT_KINDS,
  DEFAULT_OP_PROJECT,
  OpProjectSchema,
  OP_PROJECTS,
  SALE_STATUSES,
  type AccountStatus,
  type AccountKind,
  type SaleStatus
} from "@douyin-admin/shared";
import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";
import type { EncryptedValue } from "../services/encryption";

export type AccountRecord = {
  douyinId: string;
  accountKind?: AccountKind;
  email?: string;
  secUid: string;
  registeredAt: Date;
  opName: string;
  opSecret: EncryptedValue;
  accountPassword?: EncryptedValue | undefined;
  opExpiresAt: Date;
  owner: string;
  registeredRegion: string;
  saleStatus: SaleStatus;
  accountStatus: AccountStatus;
  accountCheckedAt: Date;
  remark: string;
  shortOpCode?: string;
  opProject?: typeof DEFAULT_OP_PROJECT;
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AccountDocument = HydratedDocument<AccountRecord>;

const EncryptedValueSchema = new Schema<EncryptedValue>(
  {
    version: { type: Number, required: true, enum: [1] },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true }
  },
  { _id: false }
);

const AccountSchema = new Schema<AccountRecord>(
  {
    douyinId: { type: String, required: true, trim: true },
    accountKind: { type: String, required: false, enum: ACCOUNT_KINDS },
    email: { type: String, required: false, trim: true, maxlength: 254, default: "" },
    secUid: { type: String, required: false, trim: true, default: "" },
    registeredAt: { type: Date, required: true },
    opName: { type: String, default: "", trim: true, maxlength: 100 },
    opSecret: { type: EncryptedValueSchema, required: true },
    accountPassword: { type: EncryptedValueSchema, required: false },
    opExpiresAt: { type: Date, required: true },
    owner: { type: String, required: true, trim: true, maxlength: 100 },
    registeredRegion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      default: "中国.香港"
    },
    saleStatus: { type: String, required: true, enum: SALE_STATUSES },
    accountStatus: { type: String, required: true, enum: ACCOUNT_STATUSES },
    accountCheckedAt: { type: Date, required: true },
    remark: { type: String, default: "", trim: true, maxlength: 1000 },
    shortOpCode: { type: String, required: false, match: /^[1-9][0-9]{8}$/ },
    opProject: {
      type: String,
      required: false,
      enum: OpProjectSchema.options
    },
    searchText: { type: String, required: true, default: "" }
  },
  { timestamps: true, versionKey: false }
);

AccountSchema.index({ douyinId: 1 }, { unique: true });
// Empty sec_uid is allowed when detection fails; only non-empty values stay unique.
AccountSchema.index(
  { secUid: 1 },
  { unique: true, partialFilterExpression: { secUid: { $gt: "" } } }
);
AccountSchema.index(
  { shortOpCode: 1 },
  {
    unique: true,
    partialFilterExpression: { shortOpCode: { $type: "string" } }
  }
);
AccountSchema.index({ saleStatus: 1 });
AccountSchema.index({ accountStatus: 1 });
AccountSchema.index({ registeredAt: 1 });
AccountSchema.index({ owner: 1 });
AccountSchema.index({ accountKind: 1, registeredAt: 1, _id: 1 });
AccountSchema.index({ createdAt: -1, _id: -1 });

AccountSchema.pre("validate", function buildSearchText() {
  this.searchText = [
    this.douyinId,
    this.email,
    this.secUid,
    this.opName,
    this.shortOpCode,
    OP_PROJECTS[this.opProject ?? DEFAULT_OP_PROJECT].name,
    this.owner,
    this.registeredRegion,
    this.remark
  ]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .trim();
});

export const AccountModel: Model<AccountRecord> =
  (models.Account as Model<AccountRecord> | undefined) ??
  model<AccountRecord>("Account", AccountSchema);
