import { z } from "zod";
import { APP_ROLES } from "../constants/roles";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");
const dateValue = z.coerce.date();
const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format");

const statusOptional = z.enum(["draft", "published", "expired", "archived"]).optional();

export const communicationTargetingSchema = z
  .object({
    allEmployees: z.coerce.boolean().default(false),
    departmentIds: z.array(objectId).default([]),
    roleKeys: z.array(z.enum(APP_ROLES)).default([]),
    designationIds: z.array(objectId).default([]),
    projectIds: z.array(objectId).default([]),
    userIds: z.array(objectId).default([])
  })
  .superRefine((value, ctx) => {
    const hasSpecificTargets =
      value.departmentIds.length > 0 ||
      value.roleKeys.length > 0 ||
      value.designationIds.length > 0 ||
      value.projectIds.length > 0 ||
      value.userIds.length > 0;

    if (!value.allEmployees && !hasSpecificTargets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allEmployees"],
        message: "Select at least one target audience"
      });
    }
  });

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(5).max(500),
    content: z.string().trim().min(5).max(30000),
    announcementType: z.enum(["general", "policy", "celebration", "alert", "update", "other"]),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    publishDate: dateValue,
    expiryDate: dateValue.nullable().optional(),
    targeting: communicationTargetingSchema,
    sendEmail: z.coerce.boolean().default(false),
    sendInAppNotification: z.coerce.boolean().default(true),
    acknowledgementRequired: z.coerce.boolean().default(false),
    status: statusOptional.default("draft"),
    isPinned: z.coerce.boolean().default(false),
    isUrgent: z.coerce.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.expiryDate && value.expiryDate < value.publishDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiryDate"],
        message: "Expiry date must be after publish date"
      });
    }
  });

export const announcementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional().default(""),
  announcementType: z.string().trim().optional().default("all"),
  priority: z.string().trim().optional().default("all"),
  status: z.string().trim().optional().default("all"),
  departmentId: z.string().trim().optional().default(""),
  fromDate: z.string().trim().optional().default(""),
  toDate: z.string().trim().optional().default("")
});

export const policyInputSchema = z.object({
  title: z.string().trim().min(3).max(180),
  category: z.string().trim().max(120).optional().default(""),
  summary: z.string().trim().max(500).optional().default(""),
  content: z.string().trim().min(5).max(30000),
  effectiveDate: dateValue.nullable().optional(),
  isPublished: z.coerce.boolean().default(false),
  changeSummary: z.string().trim().max(300).optional().default("")
});

export const policyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default("all"),
  isPublished: z.string().trim().optional().default("all")
});

export const policyReportQuerySchema = z.object({
  policyId: z.string().trim().optional().default(""),
  departmentId: z.string().trim().optional().default(""),
  employeeId: z.string().trim().optional().default(""),
  status: z.enum(["all", "ACKNOWLEDGED", "PENDING"]).optional().default("all")
});

export const eventReminderSchema = z
  .object({
    reminderType: z.enum(["immediate", "1_day_before", "1_hour_before", "custom"]),
    channels: z.array(z.enum(["in_app", "email"])).min(1),
    customDateTime: dateValue.nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.reminderType === "custom" && !value.customDateTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customDateTime"],
        message: "Custom reminder date time is required"
      });
    }
  });

export const eventInputSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    category: z.enum(["meeting", "training", "celebration", "townhall", "engagement", "other"]),
    description: z.string().trim().min(5).max(20000),
    publishDate: dateValue,
    startDate: dateValue,
    endDate: dateValue,
    startTime: z.string().trim().optional().default(""),
    endTime: z.string().trim().optional().default(""),
    allDay: z.coerce.boolean().default(false),
    location: z.string().trim().max(250).optional().default(""),
    mode: z.enum(["online", "offline", "hybrid"]).default("offline"),
    meetingLink: z.string().trim().max(500).optional().default(""),
    targeting: communicationTargetingSchema,
    reminderSettings: z.array(eventReminderSchema).default([]),
    sendEmail: z.coerce.boolean().default(false),
    sendInAppNotification: z.coerce.boolean().default(true),
    status: z.enum(["draft", "published", "cancelled", "completed", "archived"]).optional().default("draft")
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be on or after start date"
      });
    }

    if (!value.allDay) {
      if (!value.startTime || !hhmm.safeParse(value.startTime).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startTime"],
          message: "Start time is required in HH:mm format"
        });
      }
      if (!value.endTime || !hhmm.safeParse(value.endTime).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endTime"],
          message: "End time is required in HH:mm format"
        });
      }
    }

    if ((value.mode === "online" || value.mode === "hybrid") && !value.meetingLink) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["meetingLink"],
        message: "Meeting link is required for online or hybrid events"
      });
    }
  });

export const eventListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default("all"),
  status: z.string().trim().optional().default("all"),
  departmentId: z.string().trim().optional().default(""),
  date: z.string().trim().optional().default(""),
  fromDate: z.string().trim().optional().default(""),
  toDate: z.string().trim().optional().default("")
});

export const calendarQuerySchema = z.object({
  fromDate: z.coerce.date(),
  toDate: z.coerce.date()
});

export const rsvpSchema = z.object({
  status: z.enum(["Accepted", "Declined", "Maybe"])
});

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

export const idParamSchema = z.object({
  id: objectId
});

export function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}
