import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const AnnouncementReceiptSchema = new Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    deliveredAt: { type: Date, required: true, default: Date.now },
    openedAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

AnnouncementReceiptSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

export type AnnouncementReceipt = InferSchemaType<typeof AnnouncementReceiptSchema>;
export type AnnouncementReceiptDocument = HydratedDocument<AnnouncementReceipt>;

export default mongoose.model<AnnouncementReceipt>("AnnouncementReceipt", AnnouncementReceiptSchema);
