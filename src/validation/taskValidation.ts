import { object, z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

export const taskStatusEnum = z.enum(["Pending", "In Progress", "In Review", "Completed"]);
export const taskPriorityEnum = z.enum(["Low", "Medium", "High", "Critical"]);

export const createTaskSchema = z.object({
  projectId: objectId,
  title: z.string().trim().min(2, "Title is Required").max(180),
  description: z.string().trim().max(5000).optional().default(""),
  assignedTo: objectId,
  priority: taskPriorityEnum.default("Medium"),
  dueDate: z.coerce.date().optional(),
  estimatedHours: z.coerce.number().min(0).max(10000).optional()
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().max(5000).optional(),
  assignedTo: objectId.optional(),
  priority: taskPriorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatedHours: z.coerce.number().min(0).max(10000).nullable().optional()
});

export const updateTaskStatusSchema = z.object({
  status: taskStatusEnum
});

export const createTaskWorkLogSchema = z
  .object({
    comment: z.string().trim().min(1, "Comment is required").max(3000),
    hours: z.coerce.number().int().min(0).max(999).default(0),
    minutes: z.coerce.number().int().min(0).max(59).default(0)
  })
  .superRefine((value, ctx) => {
    if (value.hours === 0 && value.minutes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minutes"],
        message: "Enter at least some time spent"
      });
    }
  });

export const taskWorkLogIdParamSchema = z.object({
  id: objectId,
  workLogId: objectId
});

export const idParamSchema = z.object({
  id: objectId
});
export const projectIdParamSchema = z.object({
  projectId: objectId
});
export function formatZodError(err: z.ZodError) {
  return err.issues.map((e) => ({
    field: e.path.join("."),
    message: e.message
  }));
}
