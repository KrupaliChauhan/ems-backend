import { z } from "zod";
import { HOLIDAY_SCOPE_VALUES } from "../utils/holidayScope";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");
const approverRoleEnum = z.enum(["superadmin", "admin", "HR", "teamLeader"]);
const holidayScopeEnum = z.enum(HOLIDAY_SCOPE_VALUES);

const safeNumber = (min: number, max: number) =>
  z.coerce.number().refine((value) => !Number.isNaN(value), "Must be a number").min(min).max(max);

export const leaveTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/, "Code can contain letters, numbers, _ and -"),
    description: z.string().trim().max(1000).optional().default(""),
    color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/, "Invalid color")
      .default("#2563eb"),
    totalAllocation: safeNumber(0, 365),
    allocationPeriod: z.enum(["yearly", "monthly"]),
    carryForwardEnabled: z.coerce.boolean().default(false),
    maxCarryForwardLimit: safeNumber(0, 365).default(0),
    accrualEnabled: z.coerce.boolean().default(false),
    accrualAmount: safeNumber(0, 31).default(0),
    accrualFrequency: z.enum(["monthly"]).default("monthly"),
    approvalWorkflowType: z.enum(["single_level", "multi_level"]).default("single_level"),
    approvalFlowSteps: z
      .array(
        z.object({
          role: approverRoleEnum
        })
      )
      .default([{ role: "admin" }]),
    maxDaysPerRequest: safeNumber(0.5, 365),
    minNoticeDays: safeNumber(0, 365).default(0),
    allowPastDates: z.coerce.boolean().default(false),
    requiresAttachment: z.coerce.boolean().default(false),
    status: z.enum(["Active", "Inactive"]).default("Active")
  })
  .superRefine((value, ctx) => {
    if (!value.carryForwardEnabled && value.maxCarryForwardLimit !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCarryForwardLimit"],
        message: "Carry forward limit must be 0 when carry forward is disabled"
      });
    }

    if (!value.accrualEnabled && value.accrualAmount !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accrualAmount"],
        message: "Accrual amount must be 0 when accrual is disabled"
      });
    }

    if (value.approvalWorkflowType === "single_level" && value.approvalFlowSteps.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvalFlowSteps"],
        message: "Single level workflow must have exactly 1 approver"
      });
    }

    if (value.approvalWorkflowType === "multi_level" && value.approvalFlowSteps.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvalFlowSteps"],
        message: "Multi level workflow must have at least 2 approvers"
      });
    }
  });

export const idParamSchema = z.object({
  id: objectId
});

export const leaveApplySchema = z.object({
  leaveTypeId: objectId,
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  dayUnit: z.enum(["FULL", "HALF"]).default("FULL"),
  reason: z.string().trim().min(5).max(3000)
});

export const leaveListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().trim().optional().default(""),
  status: z.enum(["all", "Pending", "Level 1 Approved", "Approved", "Rejected", "Cancelled"]).default("all"),
  leaveTypeId: z.string().trim().optional().default(""),
  employeeId: z.string().trim().optional().default(""),
  fromDate: z.string().trim().optional().default(""),
  toDate: z.string().trim().optional().default("")
});

export const leaveActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  remarks: z.string().trim().max(1000).optional().default("")
});

export const leaveCancelSchema = z.object({
  remarks: z.string().trim().max(1000).optional().default("")
});

export const leaveCalendarQuerySchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000).max(3000),
  employeeId: z.string().trim().optional().default(""),
  status: z.enum(["all", "Pending", "Level 1 Approved", "Approved", "Rejected", "Cancelled"]).default("all")
});

export const leaveBalanceQuerySchema = z.object({
  employeeId: z.string().trim().optional().default(""),
  year: z.coerce.number().min(2000).max(3000).optional(),
  month: z.coerce.number().min(1).max(12).optional()
});

export const leaveTypeListQuerySchema = z.object({
  search: z.string().trim().optional().default(""),
  status: z.enum(["all", "Active", "Inactive"]).default("all"),
  workflow: z.enum(["all", "single_level", "multi_level"]).default("all")
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
  search: z.string().trim().optional().default(""),
  scope: z.union([holidayScopeEnum, z.literal("")]).default(""),
  isActive: z.enum(["all", "true", "false"]).default("all"),
  month: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().min(1).max(12).optional()
  ),
  year: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().min(2000).max(3000).optional()
  )
});

export const leaveProcessSchema = z.object({
  runDate: z.coerce.date().optional().default(() => new Date())
});

export function formatZodError(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}
