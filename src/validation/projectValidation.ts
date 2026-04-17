import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");
const memberArraySchema = z.array(objectId).min(1, "Select at least 1 member").max(200);

function normalizeProjectMembers(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const payload = value as { members?: unknown; employees?: unknown };
  return {
    ...payload,
    members: payload.members ?? payload.employees
  };
}

export const createProjectSchema = z.preprocess(normalizeProjectMembers, z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
  timeLimit: z.string().trim().min(1).max(50),
  startDate: z.coerce.date(),
  status: z.enum(["active", "pending", "completed"]).default("pending"),
  members: memberArraySchema
}));

export const updateProjectSchema = z.preprocess(normalizeProjectMembers, z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
  timeLimit: z.string().trim().min(1).max(50),
  startDate: z.coerce.date(),
  status: z.enum(["active", "pending", "completed"]),
  members: memberArraySchema
}));

export const idParamSchema = z.object({
  id: objectId
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((e) => ({
    field: e.path.join("."),
    message: e.message
  }));
}
