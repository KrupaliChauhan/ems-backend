import { z } from "zod";

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  status: z.enum(["Active", "Inactive"]).optional()
});
