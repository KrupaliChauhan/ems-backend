import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const PolicySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    code: { type: String, required: true, trim: true, maxlength: 220 },
    category: { type: String, trim: true, maxlength: 120, default: "" },
    summary: { type: String, trim: true, maxlength: 500, default: "" },
    content: { type: String, required: true, trim: true, maxlength: 30000 },
    versionNumber: { type: Number, required: true, default: 1, min: 1 },
    isPublished: { type: Boolean, required: true, default: false, index: true },
    effectiveDate: { type: Date, default: null },
    isDeleted: { type: Boolean, required: true, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },
    unpublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    unpublishedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

PolicySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
PolicySchema.index({ isPublished: 1, updatedAt: -1, isDeleted: 1 });
PolicySchema.index({ category: 1, isPublished: 1, isDeleted: 1 });

export type Policy = InferSchemaType<typeof PolicySchema>;
export type PolicyDocument = HydratedDocument<Policy>;

export default mongoose.model<Policy>("Policy", PolicySchema);
