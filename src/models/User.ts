import mongoose, { Document, Schema } from "mongoose";
import { APP_ROLES, type AppRole } from "../constants/roles";

export interface IUser extends Document {
  name: string;
  email: string;
  username: string;
  password: string;
  role: AppRole;
  department: mongoose.Types.ObjectId | null;
  designation: mongoose.Types.ObjectId | null;
  status: "Active" | "Inactive";
  isDeleted: boolean;

  // ✅ ADD
  resetPasswordToken?: string | null;
  resetPasswordExpires?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    username: { type: String, required: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: APP_ROLES,
      default: "employee"
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: false
    },

    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      required: false
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active"
    },

    isDeleted: {
      type: Boolean,
      default: false
    },

    // ✅ ADD
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null }
  },
  { timestamps: true }
);
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

UserSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
UserSchema.index({ isDeleted: 1, role: 1, status: 1, createdAt: -1 });

export default mongoose.model<IUser>("User", UserSchema);
