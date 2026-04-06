import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
  timeLimit: z.string().trim().min(1).max(50),
  startDate: z.coerce.date(),
  status: z.enum(["active", "pending", "completed"]).default("pending"),
  employees: z.array(objectId).min(1, "Select at least 1 employee").max(200)
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
  timeLimit: z.string().trim().min(1).max(50),
  startDate: z.coerce.date(),
  status: z.enum(["active", "pending", "completed"]),
  employees: z.array(objectId).min(1).max(200)
});

export const idParamSchema = z.object({
  id: objectId
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((e) => ({
    field: e.path.join("."),
    message: e.message
  }));
}
