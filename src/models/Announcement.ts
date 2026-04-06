import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { APP_ROLES } from "../constants/roles";

export const ANNOUNCEMENT_TYPES = [
  "general",
  "policy",
  "celebration",
  "alert",
  "update",
  "other"
] as const;

export const ANNOUNCEMENT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "expired", "archived"] as const;

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

const AnnouncementTargetingSchema = new Schema(
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

const AnnouncementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    content: { type: String, required: true, trim: true, maxlength: 30000 },
    announcementType: {
      type: String,
      enum: ANNOUNCEMENT_TYPES,
      default: "general",
      required: true
    },
    priority: {
      type: String,
      enum: ANNOUNCEMENT_PRIORITIES,
      default: "normal",
      required: true
    },
    publishDate: { type: Date, required: true, index: true },
    expiryDate: { type: Date, default: null, index: true },
    targeting: { type: AnnouncementTargetingSchema, required: true },
    attachments: { type: [UploadedFileSchema], default: [] },
    bannerImage: { type: UploadedFileSchema, default: null },
    sendEmail: { type: Boolean, required: true, default: false },
    sendInAppNotification: { type: Boolean, required: true, default: true },
    acknowledgementRequired: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUSES,
      default: "draft",
      required: true,
      index: true
    },
    isPinned: { type: Boolean, required: true, default: false },
    isUrgent: { type: Boolean, required: true, default: false },
    distributionProcessedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, required: true, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

AnnouncementSchema.index({ status: 1, publishDate: -1, isDeleted: 1 });
AnnouncementSchema.index({ "targeting.departmentIds": 1, status: 1 });
AnnouncementSchema.index({ "targeting.roleKeys": 1, status: 1 });
AnnouncementSchema.index({ "targeting.designationIds": 1, status: 1 });
AnnouncementSchema.index({ "targeting.projectIds": 1, status: 1 });
AnnouncementSchema.index({ "targeting.userIds": 1, status: 1 });

export type Announcement = InferSchemaType<typeof AnnouncementSchema>;
export type AnnouncementDocument = HydratedDocument<Announcement>;

export default mongoose.model<Announcement>("Announcement", AnnouncementSchema);
