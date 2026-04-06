import mongoose, { Document, Schema } from "mongoose";

export interface IProject extends Document {
  name: string;
  description: string;
  timeLimit: string;
  startDate: Date;
  status: "active" | "pending" | "completed";
  employees: mongoose.Types.ObjectId[];

  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId | null;

  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const ProjectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    timeLimit: { type: String, required: true, trim: true, maxlength: 50 },
    startDate: { type: Date, required: true },

    status: {
      type: String,
      enum: ["active", "pending", "completed"],
      default: "pending",
      required: true
    },

    employees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      }
    ],
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

ProjectSchema.index({ isDeleted: 1, createdAt: -1 });
ProjectSchema.index({ employees: 1, isDeleted: 1 });

export default mongoose.model<IProject>("Project", ProjectSchema);
