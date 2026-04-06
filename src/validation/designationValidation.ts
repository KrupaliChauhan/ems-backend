import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const designationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Designation name is required")
    .max(100, "Designation name too long"),

  departmentId: z.string().trim().regex(objectIdRegex, "Invalid Department"),

  status: z.enum(["Active", "Inactive"]).optional().default("Active")
});
