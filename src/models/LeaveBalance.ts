import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const LeaveBalanceSchema = new Schema(
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
    year: { type: Number, required: true, min: 2000, max: 3000, index: true },
    month: { type: Number, default: null, min: 1, max: 12, index: true },
    cycleKey: { type: String, required: true, trim: true, index: true },
    totalAllocated: { type: Number, default: 0, min: 0 },
    accrued: { type: Number, default: 0, min: 0 },
    carriedForward: { type: Number, default: 0, min: 0 },
    used: { type: Number, default: 0, min: 0 },
    pending: { type: Number, default: 0, min: 0 },
    processedAccrualPeriods: [{ type: String, trim: true }],
    carryForwardSourceCycleKey: { type: String, default: null },
    lastAccrualRunAt: { type: Date, default: null },
    lastCarryForwardRunAt: { type: Date, default: null }
  },
  { timestamps: true }
);

LeaveBalanceSchema.index({ employeeId: 1, leaveTypeId: 1, cycleKey: 1 }, { unique: true });
LeaveBalanceSchema.index({ leaveTypeId: 1, cycleKey: 1 });

export type LeaveBalance = InferSchemaType<typeof LeaveBalanceSchema>;
export type LeaveBalanceDocument = HydratedDocument<LeaveBalance>;

export default mongoose.model<LeaveBalance>("LeaveBalance", LeaveBalanceSchema);
