import { model, models, Schema, type Model } from "mongoose";

export type AdminRecord = {
  _id: "primary";
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

const AdminSchema = new Schema<AdminRecord>(
  {
    _id: { type: String, required: true },
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100
    },
    passwordSalt: { type: String, required: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true, versionKey: false }
);

export const AdminModel: Model<AdminRecord> =
  (models.Admin as Model<AdminRecord> | undefined) ??
  model<AdminRecord>("Admin", AdminSchema);
