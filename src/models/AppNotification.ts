import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const APP_NOTIFICATION_TYPES = [
  "announcement",
  "event",
  "event_reminder",
  "leave_status",
  "task_assignment",
  "task_due",
  "task_overdue",
  "project_member_added",
  "policy_acknowledgment_reminder"
] as const;

const AppNotificationSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 600 },
    type: {
      type: String,
      enum: APP_NOTIFICATION_TYPES,
      required: true
    },
    link: { type: String, required: true, trim: true, maxlength: 400 },
    entityType: { type: String, required: true, trim: true, maxlength: 50 },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    dedupeKey: { type: String, required: true, trim: true, unique: true },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

AppNotificationSchema.index({ userId: 1, createdAt: -1 });
AppNotificationSchema.index({ userId: 1, readAt: 1 });

export type AppNotification = InferSchemaType<typeof AppNotificationSchema>;
export type AppNotificationDocument = HydratedDocument<AppNotification>;

export default mongoose.model<AppNotification>("AppNotification", AppNotificationSchema);
