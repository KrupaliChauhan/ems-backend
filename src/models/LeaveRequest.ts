import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { APP_ROLES } from "../constants/roles";

export const LEAVE_REQUEST_DAY_UNITS = ["FULL", "HALF"] as const;
export const LEAVE_REQUEST_STATUSES = [
  "Pending",
  "Level 1 Approved",
  "Approved",
  "Rejected",
  "Cancelled"
] as const;

const LeaveAttachmentSchema = new Schema(
  {
    originalName: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 0 },
    path: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const LeaveApprovalHistorySchema = new Schema(
  {
    level: { type: Number, required: true, min: 0, max: 10 },
    action: {
      type: String,
      enum: ["Submitted", "Approved", "Rejected", "Cancelled"],
      required: true
    },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: APP_ROLES, required: true },
    remarks: { type: String, trim: true, maxlength: 1000, default: "" },
    actedAt: { type: Date, required: true, default: Date.now }
  },
  { _id: false }
);

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

const LeaveRequestSchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    leaveTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveType",
      required: true,
      index: true
    },
    leaveTypeSnapshot: {
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, trim: true },
      color: { type: String, required: true, trim: true }
    },
    fromDate: { type: Date, required: true, index: true },
    toDate: { type: Date, required: true, index: true },
    dayUnit: {
      type: String,
      enum: LEAVE_REQUEST_DAY_UNITS,
      default: "FULL",
      required: true
    },
    totalDays: { type: Number, required: true, min: 0.5, max: 365 },
    reason: { type: String, required: true, trim: true, maxlength: 3000 },
    attachment: { type: LeaveAttachmentSchema, default: null },
    status: {
      type: String,
      enum: LEAVE_REQUEST_STATUSES,
      default: "Pending",
      required: true,
      index: true
    },
    currentApprovalLevel: { type: Number, default: 0, min: 0, max: 10 },
    balanceCycleKey: { type: String, required: true, trim: true, index: true },
    approvalWorkflowType: {
      type: String,
      enum: ["single_level", "multi_level", "two_level"],
      required: true
    },
    approvalFlowSteps: { type: [LeaveApprovalFlowStepSchema], default: [] },
    approvalHistory: { type: [LeaveApprovalHistorySchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

LeaveRequestSchema.index({ employeeId: 1, status: 1, createdAt: -1 });
LeaveRequestSchema.index({ leaveTypeId: 1, status: 1, fromDate: 1 });
LeaveRequestSchema.index({ fromDate: 1, toDate: 1, status: 1 });

export type LeaveRequest = InferSchemaType<typeof LeaveRequestSchema>;
export type LeaveRequestDocument = HydratedDocument<LeaveRequest>;

export default mongoose.model<LeaveRequest>("LeaveRequest", LeaveRequestSchema);
