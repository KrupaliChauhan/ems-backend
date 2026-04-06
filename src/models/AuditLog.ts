import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { APP_ROLES } from "../constants/roles";

const AuditLogSchema = new Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    actorRole: {
      type: String,
      enum: APP_ROLES,
      required: true
    },
    action: { type: String, required: true, trim: true, maxlength: 120, index: true },
    entityType: { type: String, required: true, trim: true, maxlength: 80, index: true },
    entityId: { type: String, required: true, trim: true, maxlength: 120, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    metadata: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });

export type AuditLog = InferSchemaType<typeof AuditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLog>;

export default mongoose.model<AuditLog>("AuditLog", AuditLogSchema);

