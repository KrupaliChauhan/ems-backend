import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "HALF_DAY",
  "ABSENT",
  "LEAVE",
  "HOLIDAY",
  "WEEK_OFF",
  "MISSED_PUNCH",
  "HALF_DAY_LEAVE_PRESENT"
] as const;

const AttendanceDailySummarySchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 3000, index: true },
    month: { type: Number, required: true, min: 1, max: 12, index: true },
    totalWorkMinutes: { type: Number, required: true, min: 0, default: 0 },
    totalBreakMinutes: { type: Number, required: true, min: 0, default: 0 },
    firstIn: { type: Date, default: null },
    lastOut: { type: Date, default: null },
    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      required: true,
      default: "ABSENT",
      index: true
    },
    lateMinutes: { type: Number, required: true, min: 0, default: 0 },
    isHalfDayLeave: { type: Boolean, required: true, default: false },
    leaveId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveRequest", default: null },
    holidayId: { type: mongoose.Schema.Types.ObjectId, ref: "Holiday", default: null },
    weeklyOffApplied: { type: Boolean, required: true, default: false },
    remarks: { type: String, trim: true, maxlength: 1000, default: "" },
    missedPunch: { type: Boolean, required: true, default: false },
    punchCount: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

AttendanceDailySummarySchema.index({ employeeId: 1, dateKey: 1 }, { unique: true });
AttendanceDailySummarySchema.index({ status: 1, date: 1 });
AttendanceDailySummarySchema.index({ month: 1, year: 1, employeeId: 1 });

export type AttendanceDailySummary = InferSchemaType<typeof AttendanceDailySummarySchema>;
export type AttendanceDailySummaryDocument = HydratedDocument<AttendanceDailySummary>;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export default mongoose.model<AttendanceDailySummary>(
  "AttendanceDailySummary",
  AttendanceDailySummarySchema
);
