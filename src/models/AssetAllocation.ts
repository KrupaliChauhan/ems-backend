import mongoose, { Schema, Document } from "mongoose";

export interface IAssetAllocation extends Document {
  assetId: mongoose.Types.ObjectId; // ref Asset
  employeeId: mongoose.Types.ObjectId; // ref User (role employee)
  allocatedOn: Date;
  expectedReturnOn?: Date;
  returnedOn?: Date | null;

  allocatedBy?: mongoose.Types.ObjectId; // ref User (admin/superadmin)
  notes?: string;
  returnCondition?: string;

  createdAt: Date;
  updatedAt: Date;
}

const AssetAllocationSchema = new Schema<IAssetAllocation>(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true
    },
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    allocatedOn: { type: Date, required: true },
    expectedReturnOn: { type: Date },
    returnedOn: { type: Date, default: null, index: true },

    allocatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
    returnCondition: { type: String }
  },
  { timestamps: true }
);

// Fast current allocation lookups
AssetAllocationSchema.index({ assetId: 1, returnedOn: 1 });
AssetAllocationSchema.index({ employeeId: 1, returnedOn: 1 });

export default mongoose.model<IAssetAllocation>("AssetAllocation", AssetAllocationSchema);
