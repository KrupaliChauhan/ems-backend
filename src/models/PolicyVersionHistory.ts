import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const PolicyVersionHistorySchema = new Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
      index: true
    },
    versionNumber: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    category: { type: String, trim: true, maxlength: 120, default: "" },
    summary: { type: String, trim: true, maxlength: 500, default: "" },
    content: { type: String, required: true, trim: true, maxlength: 30000 },
    effectiveDate: { type: Date, default: null },
    isPublished: { type: Boolean, required: true, default: false },
    changeSummary: { type: String, trim: true, maxlength: 300, default: "" },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    changedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: false }
);

PolicyVersionHistorySchema.index({ policyId: 1, versionNumber: -1 });

export type PolicyVersionHistory = InferSchemaType<typeof PolicyVersionHistorySchema>;
export type PolicyVersionHistoryDocument = HydratedDocument<PolicyVersionHistory>;

export default mongoose.model<PolicyVersionHistory>("PolicyVersionHistory", PolicyVersionHistorySchema);
