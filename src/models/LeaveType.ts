import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

export const LEAVE_ALLOCATION_PERIODS = ["yearly", "monthly"] as const;
export const LEAVE_APPROVAL_WORKFLOWS = ["single_level", "multi_level", "two_level"] as const;
export const LEAVE_STATUSES = ["Active", "Inactive"] as const;

const LeaveApprovalFlowStepSchema = new Schema(
  {
    level: { type: Number, required: true, min: 1, max: 10 },
    role: {
      type: String,
      enum: ["superadmin", "admin", "HR", "teamLeader"],
      required: true
    }
  },
  { _id: false }
);

const LeaveTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    color: { type: String, trim: true, maxlength: 20, default: "#2563eb" },
    totalAllocation: { type: Number, required: true, min: 0, max: 365 },
    allocationPeriod: {
      type: String,
      enum: LEAVE_ALLOCATION_PERIODS,
      default: "yearly",
      required: true
    },
    carryForwardEnabled: { type: Boolean, default: false },
    maxCarryForwardLimit: { type: Number, default: 0, min: 0, max: 365 },
    accrualEnabled: { type: Boolean, default: false },
    accrualAmount: { type: Number, default: 0, min: 0, max: 31 },
    accrualFrequency: {
      type: String,
      enum: ["monthly"],
      default: "monthly"
    },
    approvalWorkflowType: {
      type: String,
      enum: LEAVE_APPROVAL_WORKFLOWS,
      default: "single_level",
      required: true
    },
    approvalFlowSteps: {
      type: [LeaveApprovalFlowStepSchema],
      default: [{ level: 1, role: "admin" }]
    },
    maxDaysPerRequest: { type: Number, required: true, min: 0.5, max: 365 },
    minNoticeDays: { type: Number, default: 0, min: 0, max: 365 },
    allowPastDates: { type: Boolean, default: false },
    requiresAttachment: { type: Boolean, default: false },
    status: {
      type: String,
      enum: LEAVE_STATUSES,
      default: "Active",
      required: true
    },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

LeaveTypeSchema.index({ isDeleted: 1, status: 1, createdAt: -1 });
LeaveTypeSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
LeaveTypeSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export type LeaveType = InferSchemaType<typeof LeaveTypeSchema>;
export type LeaveTypeDocument = HydratedDocument<LeaveType>;

export default mongoose.model<LeaveType>("LeaveType", LeaveTypeSchema);
