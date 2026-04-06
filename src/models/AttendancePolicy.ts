import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const ATTENDANCE_WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;

const AttendancePolicySchema = new Schema(
  {
    key: { type: String, required: true, trim: true, default: "default" },
    officeStartTime: { type: String, required: true, trim: true, default: "09:30" },
    officeEndTime: { type: String, required: true, trim: true, default: "18:30" },
    graceMinutes: { type: Number, required: true, min: 0, max: 180, default: 15 },
    halfDayMinutes: { type: Number, required: true, min: 1, max: 1440, default: 240 },
    fullDayMinutes: { type: Number, required: true, min: 1, max: 1440, default: 480 },
    weeklyOffs: {
      type: [{ type: Number, enum: ATTENDANCE_WEEKDAY_VALUES }],
      default: [0]
    },
    multiplePunchAllowed: { type: Boolean, required: true, default: true },
    enableHolidayIntegration: { type: Boolean, required: true, default: true },
    enableLeaveIntegration: { type: Boolean, required: true, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

AttendancePolicySchema.index({ key: 1 }, { unique: true });

export type AttendancePolicy = InferSchemaType<typeof AttendancePolicySchema>;
export type AttendancePolicyDocument = HydratedDocument<AttendancePolicy>;

export default mongoose.model<AttendancePolicy>("AttendancePolicy", AttendancePolicySchema);
