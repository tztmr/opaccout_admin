import {
  ACCOUNT_STATUSES,
  SALE_STATUSES,
  type AccountStatus,
  type SaleStatus
} from "@douyin-admin/shared";
import { model, models, Schema, type HydratedDocument, type Model } from "mongoose";
import type { EncryptedValue } from "../services/encryption";

export type AccountRecord = {
  douyinId: string;
  secUid: string;
  registeredAt: Date;
  opName: string;
  opSecret: EncryptedValue;
  opExpiresAt: Date;
  owner: string;
  saleStatus: SaleStatus;
  accountStatus: AccountStatus;
  accountCheckedAt: Date;
  remark: string;
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
    secUid: { type: String, required: true, trim: true },
    registeredAt: { type: Date, required: true },
    opName: { type: String, default: "", trim: true, maxlength: 100 },
    opSecret: { type: EncryptedValueSchema, required: true },
    opExpiresAt: { type: Date, required: true },
    owner: { type: String, required: true, trim: true, maxlength: 100 },
    saleStatus: { type: String, required: true, enum: SALE_STATUSES },
    accountStatus: { type: String, required: true, enum: ACCOUNT_STATUSES },
    accountCheckedAt: { type: Date, required: true },
    remark: { type: String, default: "", trim: true, maxlength: 1000 },
    searchText: { type: String, required: true, default: "" }
  },
  { timestamps: true, versionKey: false }
);

AccountSchema.index({ douyinId: 1 }, { unique: true });
AccountSchema.index({ secUid: 1 }, { unique: true });
AccountSchema.index({ saleStatus: 1 });
AccountSchema.index({ accountStatus: 1 });
AccountSchema.index({ registeredAt: 1 });
AccountSchema.index({ owner: 1 });
AccountSchema.index({ createdAt: -1, _id: -1 });

AccountSchema.pre("validate", function buildSearchText() {
  this.searchText = [
    this.douyinId,
    this.secUid,
    this.opName,
    this.owner,
    this.remark
  ]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .trim();
});

export const AccountModel: Model<AccountRecord> =
  (models.Account as Model<AccountRecord> | undefined) ??
  model<AccountRecord>("Account", AccountSchema);
