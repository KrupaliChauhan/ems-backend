import mongoose, { Document, Schema } from "mongoose";

export interface IDepartment extends Document {
  name: string;
  status: "Active" | "Inactive";
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
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

export default mongoose.model<IDepartment>("Department", DepartmentSchema);
