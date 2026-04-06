import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const EVENT_RSVP_STATUSES = ["Pending", "Accepted", "Declined", "Maybe"] as const;

const EventInvitationSchema = new Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunicationEvent",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: EVENT_RSVP_STATUSES,
      default: "Pending",
      required: true
    },
    openedAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

EventInvitationSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export type EventInvitation = InferSchemaType<typeof EventInvitationSchema>;
export type EventInvitationDocument = HydratedDocument<EventInvitation>;

export default mongoose.model<EventInvitation>("EventInvitation", EventInvitationSchema);
