import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const ATTENDANCE_PUNCH_TYPES = ["IN", "OUT"] as const;
export const ATTENDANCE_PUNCH_SOURCES = ["web", "manual"] as const;

const AttendancePunchSchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    punchTime: { type: Date, required: true, index: true },
    punchType: {
      type: String,
      enum: ATTENDANCE_PUNCH_TYPES,
      required: true
    },
    source: {
      type: String,
      enum: ATTENDANCE_PUNCH_SOURCES,
      default: "web",
      required: true
    },
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

AttendancePunchSchema.index({ employeeId: 1, dateKey: 1, punchTime: 1 });

export type AttendancePunch = InferSchemaType<typeof AttendancePunchSchema>;
export type AttendancePunchDocument = HydratedDocument<AttendancePunch>;

export default mongoose.model<AttendancePunch>("AttendancePunch", AttendancePunchSchema);
