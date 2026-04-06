import { z } from "zod";
import { HOLIDAY_SCOPE_VALUES } from "../utils/holidayScope";
import { DEFAULT_WEEKLY_OFFS } from "../constants/calendar";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format");
const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const safeNumber = (min: number, max: number) =>
  z.coerce.number().refine((value) => !Number.isNaN(value), "Must be a number").min(min).max(max);
const holidayScopeEnum = z.enum(HOLIDAY_SCOPE_VALUES);

export const attendancePolicySchema = z
  .object({
    officeStartTime: hhmm,
    officeEndTime: hhmm,
    graceMinutes: safeNumber(0, 180),
    halfDayMinutes: safeNumber(1, 1440),
    fullDayMinutes: safeNumber(1, 1440),
    weeklyOffs: z.array(z.coerce.number().int().min(0).max(6)).default([...DEFAULT_WEEKLY_OFFS]),
    multiplePunchAllowed: z.coerce.boolean().default(true),
    enableHolidayIntegration: z.coerce.boolean().default(true),
    enableLeaveIntegration: z.coerce.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.halfDayMinutes > value.fullDayMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["halfDayMinutes"],
        message: "Half day minutes cannot be greater than full day minutes"
      });
    }
  });

export const attendancePunchSchema = z.object({
  employeeId: objectId.optional(),
  punchTime: z.coerce.date().optional().default(() => new Date()),
  punchType: z.enum(["IN", "OUT"]),
  source: z.enum(["web", "manual"]).optional().default("web"),
  remarks: z.string().trim().max(500).optional().default("")
});

export const attendanceDailyQuerySchema = z.object({
  date: z.coerce.date().optional().default(() => new Date())
});

export const attendanceMonthlyQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(3000)
});

export const attendanceListQuerySchema = z.object({
  employeeId: z.string().trim().optional().default(""),
  departmentId: z.string().trim().optional().default(""),
  month: z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(1).max(12).optional()),
  year: z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(2000).max(3000).optional()),
  status: z
    .enum(["all", "PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "HOLIDAY", "WEEK_OFF", "MISSED_PUNCH", "HALF_DAY_LEAVE_PRESENT"])
    .default("all"),
  fromDate: z.string().trim().optional().default(""),
  toDate: z.string().trim().optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export const attendanceRangeRecomputeSchema = z.object({
  employeeId: objectId.optional(),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date()
});

export const attendanceSingleRecomputeSchema = z.object({
  employeeId: objectId,
  date: z.coerce.date()
});

export const holidaySchema = z.object({
  name: z.string().trim().min(2).max(150),
  date: z.coerce.date(),
  description: z.string().trim().max(500).optional().default(""),
  scope: holidayScopeEnum.optional().default("COMPANY"),
  departmentId: z.string().trim().optional().default(""),
  isActive: z.coerce.boolean().optional().default(true)
}).superRefine((value, ctx) => {
  if (value.scope === "DEPARTMENT" && !value.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["departmentId"],
      message: "Department is required for department specific holiday"
    });
  }

  if (value.departmentId && !objectId.safeParse(value.departmentId).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["departmentId"],
      message: "Invalid department"
    });
  }
});

export const holidayListQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(3000).optional()
});

export const idParamSchema = z.object({
  id: objectId
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}
