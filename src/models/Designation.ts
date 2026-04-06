import mongoose, { Document, Schema } from "mongoose";

export interface IDesignation extends Document {
  name: string;
  department: mongoose.Types.ObjectId;
  status: "Active" | "Inactive";
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DesignationSchema = new Schema<IDesignation>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active"
    },
    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IDesignation>("Designation", DesignationSchema);
