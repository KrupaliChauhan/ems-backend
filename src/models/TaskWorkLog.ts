import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const TaskWorkLogSchema = new Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    comment: { type: String, required: true, trim: true, maxlength: 3000 },
    hours: { type: Number, required: true, min: 0, max: 999 },
    minutes: { type: Number, required: true, min: 0, max: 59 },
    totalMinutes: { type: Number, required: true, min: 1, max: 60000 },
    descriptionSnapshot: { type: String, trim: true, maxlength: 5000, default: "" }
  },
  { timestamps: true }
);

TaskWorkLogSchema.index({ taskId: 1, createdAt: -1 });
TaskWorkLogSchema.index({ userId: 1, createdAt: -1 });

export type TaskWorkLog = InferSchemaType<typeof TaskWorkLogSchema>;
export type TaskWorkLogDocument = HydratedDocument<TaskWorkLog>;

export default mongoose.model<TaskWorkLog>("TaskWorkLog", TaskWorkLogSchema);
