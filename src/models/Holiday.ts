import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { HOLIDAY_SCOPE_VALUES, normalizeHolidayScope } from "../utils/holidayScope";

const HolidaySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    scope: {
      type: String,
      enum: HOLIDAY_SCOPE_VALUES,
      required: true,
      default: "COMPANY",
      set: (value: string) => normalizeHolidayScope(value)
    },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

HolidaySchema.index({ dateKey: 1, scope: 1, departmentId: 1 }, { unique: true });

export type Holiday = InferSchemaType<typeof HolidaySchema>;
export type HolidayDocument = HydratedDocument<Holiday>;

export default mongoose.model<Holiday>("Holiday", HolidaySchema);
