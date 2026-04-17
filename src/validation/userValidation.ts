import { z } from "zod";
import { APP_ROLES } from "../constants/roles";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");
const optionalObjectId = z.preprocess(
  (value) => {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }

    return value;
  },
  objectId.optional()
);

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  role: z.enum(APP_ROLES),
  joiningDate: z.coerce.date(),
  teamLeaderId: optionalObjectId,
  departmentId: optionalObjectId,
  designationId: optionalObjectId
}).superRefine((data, ctx) => {
  if (data.role === "admin") {
    return;
  }

  if (!data.departmentId) {
    ctx.addIssue({
      code: "custom",
      path: ["departmentId"],
      message: "Department is required"
    });
  }

  if (!data.designationId) {
    ctx.addIssue({
      code: "custom",
      path: ["designationId"],
      message: "Designation is required"
    });
  }
});

export const updateUserSchema = createUserSchema.extend({
  status: z.enum(["Active", "Inactive"]).optional(),
  isActive: z.coerce.boolean().optional()
});

export const updateUserStatusSchema = z
  .object({
    status: z.enum(["Active", "Inactive"]).optional(),
    isActive: z.coerce.boolean().optional()
  })
  .refine((value) => value.status !== undefined || value.isActive !== undefined, {
    message: "Either status or isActive is required"
  });
