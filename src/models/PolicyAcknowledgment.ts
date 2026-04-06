import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const PolicyAcknowledgmentSchema = new Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
      index: true
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    versionNumber: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["ACKNOWLEDGED"],
      default: "ACKNOWLEDGED",
      required: true
    },
    acknowledgedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

PolicyAcknowledgmentSchema.index({ policyId: 1, employeeId: 1, versionNumber: 1 }, { unique: true });
PolicyAcknowledgmentSchema.index({ employeeId: 1, policyId: 1, versionNumber: -1 });

export type PolicyAcknowledgment = InferSchemaType<typeof PolicyAcknowledgmentSchema>;
export type PolicyAcknowledgmentDocument = HydratedDocument<PolicyAcknowledgment>;

export default mongoose.model<PolicyAcknowledgment>("PolicyAcknowledgment", PolicyAcknowledgmentSchema);
