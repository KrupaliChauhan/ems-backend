import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { APP_ROLES } from "../constants/roles";

export const EVENT_CATEGORIES = [
  "meeting",
  "training",
  "celebration",
  "townhall",
  "engagement",
  "other"
] as const;

export const EVENT_MODES = ["online", "offline", "hybrid"] as const;
export const EVENT_STATUSES = ["draft", "published", "cancelled", "completed", "archived"] as const;

const UploadedFileSchema = new Schema(
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

const EventTargetingSchema = new Schema(
  {
    allEmployees: { type: Boolean, default: false },
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    roleKeys: [{ type: String, enum: APP_ROLES }],
    designationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Designation" }],
    projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Project" }],
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { _id: false }
);

const EventReminderSchema = new Schema(
  {
    reminderType: {
      type: String,
      enum: ["immediate", "1_day_before", "1_hour_before", "custom"],
      required: true
    },
    channels: {
      type: [String],
      default: ["in_app"],
      validate: {
        validator: (value: string[]) =>
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((channel) => channel === "in_app" || channel === "email"),
        message: "Reminder channels must be in_app and/or email"
      }
    },
    customDateTime: { type: Date, default: null },
    processedAt: { type: Date, default: null }
  },
  { _id: true }
);

const CommunicationEventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    category: {
      type: String,
      enum: EVENT_CATEGORIES,
      default: "meeting",
      required: true
    },
    description: { type: String, required: true, trim: true, maxlength: 20000 },
    publishDate: { type: Date, required: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    startTime: { type: String, trim: true, default: "" },
    endTime: { type: String, trim: true, default: "" },
    allDay: { type: Boolean, required: true, default: false },
    location: { type: String, trim: true, maxlength: 250, default: "" },
    mode: {
      type: String,
      enum: EVENT_MODES,
      default: "offline",
      required: true
    },
    meetingLink: { type: String, trim: true, maxlength: 500, default: "" },
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    organizerName: { type: String, required: true, trim: true, maxlength: 160 },
    targeting: { type: EventTargetingSchema, required: true },
    attachments: { type: [UploadedFileSchema], default: [] },
    bannerImage: { type: UploadedFileSchema, default: null },
    reminderSettings: { type: [EventReminderSchema], default: [] },
    sendEmail: { type: Boolean, required: true, default: false },
    sendInAppNotification: { type: Boolean, required: true, default: true },
    status: {
      type: String,
      enum: EVENT_STATUSES,
      default: "draft",
      required: true,
      index: true
    },
    distributionProcessedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, required: true, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    archivedAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null }
  },
  { timestamps: true }
);

CommunicationEventSchema.index({ status: 1, startDate: 1, isDeleted: 1 });
CommunicationEventSchema.index({ "targeting.departmentIds": 1, status: 1 });
CommunicationEventSchema.index({ "targeting.roleKeys": 1, status: 1 });
CommunicationEventSchema.index({ "targeting.designationIds": 1, status: 1 });
CommunicationEventSchema.index({ "targeting.projectIds": 1, status: 1 });
CommunicationEventSchema.index({ "targeting.userIds": 1, status: 1 });

export type CommunicationEvent = InferSchemaType<typeof CommunicationEventSchema>;
export type CommunicationEventDocument = HydratedDocument<CommunicationEvent>;

export default mongoose.model<CommunicationEvent>("CommunicationEvent", CommunicationEventSchema);
