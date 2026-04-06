import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type AssetStatus = "IN_STOCK" | "ALLOCATED" | "REPAIR" | "RETIRED" | "LOST";

const AssetSchema = new Schema(
  {
    assetCode: { type: String, required: true, trim: true },
    serialNo: {
      type: String,
      trim: true
    },

    name: { type: String, required: true, trim: true },
    category: { type: String, required: false, trim: true },
    brand: { type: String, required: false, trim: true },
    model: { type: String, required: false, trim: true },

    purchaseDate: { type: Date },
    warrantyEndDate: { type: Date },
    cost: { type: Number },

    status: {
      type: String,
      enum: ["IN_STOCK", "ALLOCATED", "REPAIR", "RETIRED", "LOST"],
      default: "IN_STOCK"
    },

    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

AssetSchema.index({ assetCode: 1 }, { unique: true });
AssetSchema.index({ serialNo: 1 }, { unique: true, sparse: true });

export type IAsset = InferSchemaType<typeof AssetSchema>;

export default mongoose.model<IAsset>("Asset", AssetSchema);
