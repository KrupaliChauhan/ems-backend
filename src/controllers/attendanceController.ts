import type { Request, Response } from "express";
import AttendancePolicy from "../models/AttendancePolicy";
import Holiday from "../models/Holiday";
import Department from "../models/Department";
import Project from "../models/Project";
import {
  addAttendancePunch,
  AttendanceServiceError,
  ensureAttendancePolicy,
  getAttendanceDashboardSummary,
  getAttendanceDay,
  getAttendanceMonth,
  listAttendance,
  listAttendanceEmployees,
  listHolidays,
  recomputeAttendanceForEmployeeDate,
  recomputeAttendanceRange
} from "../services/attendanceService";
import { startOfDay, toYmd } from "../services/leaveService";
import { getTeamMemberIdsByLeader } from "../services/userService";
import { buildHolidayPayload, validateHolidayDepartment } from "../services/holidayService";
import {
  attendanceDailyQuerySchema,
  attendanceListQuerySchema,
  attendanceMonthlyQuerySchema,
  attendancePolicySchema,
  attendancePunchSchema,
  attendanceRangeRecomputeSchema,
  attendanceSingleRecomputeSchema,
  formatZodError,
  holidayListQuerySchema,
  holidaySchema,
  idParamSchema
} from "../validation/attendanceValidation";
import {
  ATTENDANCE_MANAGER_ROLES,
  SELF_ATTENDANCE_ROLES,
  hasAnyRole,
  type AppRole
} from "../constants/roles";
import {
  buildHolidayConflictFilter,
  ensureHolidayIndexes,
  normalizeHolidayScope
} from "../utils/holidayScope";

type AuthUser = {
  id: string;
  role: AppRole;
};

function getAuthUser(req: Request) {
  return (req as Request & { user?: AuthUser }).user;
}

function isAdminOrSuperAdmin(role?: string) {
  return hasAnyRole(role, ATTENDANCE_MANAGER_ROLES);
}

function resolveAttendanceErrorStatus(error: unknown, fallbackStatus = 400) {
  if (error instanceof AttendanceServiceError) {
    return error.statusCode;
  }

  return fallbackStatus;
}

async function getTeamLeaderScopedEmployeeIds(userId: string) {
  return getTeamMemberIdsByLeader(userId);
}

function buildPolicyPayload(doc: Awaited<ReturnType<typeof ensureAttendancePolicy>>) {
  return {
    id: doc._id,
    officeStartTime: doc.officeStartTime,
    officeEndTime: doc.officeEndTime,
    graceMinutes: doc.graceMinutes,
    halfDayMinutes: doc.halfDayMinutes,
    fullDayMinutes: doc.fullDayMinutes,
    weeklyOffs: doc.weeklyOffs,
    multiplePunchAllowed: doc.multiplePunchAllowed,
    enableHolidayIntegration: doc.enableHolidayIntegration,
    enableLeaveIntegration: doc.enableLeaveIntegration,
    updatedAt: doc.updatedAt
  };
}

export const getAttendancePolicy = async (_req: Request, res: Response) => {
  try {
    const policy = await ensureAttendancePolicy();
    return res.status(200).json({
      success: true,
      data: buildPolicyPayload(policy)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch attendance policy" });
  }
};

export const upsertAttendancePolicy = async (req: Request, res: Response) => {
  try {
    const parsed = attendancePolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const updated = await AttendancePolicy.findOneAndUpdate(
      { key: "default" },
      {
        key: "default",
        ...parsed.data,
        updatedBy: authUser?.id ?? null
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        runValidators: true
      }
    );

    return res.status(200).json({
      success: true,
      message: "Attendance policy updated successfully",
      data: buildPolicyPayload(updated)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update attendance policy" });
  }
};

export const createAttendancePunch = async (req: Request, res: Response) => {
  try {
    const parsed = attendancePunchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const canSelfPunch = hasAnyRole(authUser.role, SELF_ATTENDANCE_ROLES);

    if (isAdminOrSuperAdmin(authUser.role) && !canSelfPunch && !parsed.data.employeeId) {
      return res.status(400).json({
        success: false,
        message: "employeeId is required for admin punch entry"
      });
    }

    const employeeId = isAdminOrSuperAdmin(authUser.role)
      ? (parsed.data.employeeId as string | undefined) || (canSelfPunch ? authUser.id : undefined)
      : authUser.id;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "employeeId is required for admin punch entry"
      });
    }

    const created = await addAttendancePunch({
      employeeId,
      punchTime: parsed.data.punchTime,
      punchType: parsed.data.punchType,
      source: parsed.data.source,
      remarks: parsed.data.remarks,
      createdBy: authUser.id,
      actorRole: authUser.role
    });

    return res.status(201).json({
      success: true,
      message: "Attendance punch added successfully",
      data: {
        id: created._id,
        employeeId: created.employeeId,
        date: created.date,
        dateKey: created.dateKey,
        punchTime: created.punchTime,
        punchType: created.punchType,
        source: created.source,
        remarks: created.remarks
      }
    });
  } catch (error) {
    return res.status(resolveAttendanceErrorStatus(error)).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to add attendance punch"
    });
  }
};

export const getMyDailyAttendance = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    if (!hasAnyRole(authUser.role, SELF_ATTENDANCE_ROLES)) {
      return res
        .status(403)
        .json({ success: false, message: "Only self-attendance roles can access self attendance" });
    }

    const parsed = attendanceDailyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid attendance date" });
    }

    const data = await getAttendanceDay(authUser.id, parsed.data.date);
    return res.status(200).json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch daily attendance" });
  }
};

export const getMyMonthlyAttendance = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    if (!hasAnyRole(authUser.role, SELF_ATTENDANCE_ROLES)) {
      return res
        .status(403)
        .json({ success: false, message: "Only self-attendance roles can access self attendance" });
    }

    const parsed = attendanceMonthlyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid monthly attendance query" });
    }

    const data = await getAttendanceMonth(authUser.id, parsed.data.month, parsed.data.year);
    return res.status(200).json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch monthly attendance" });
  }
};

export const getAttendanceList = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const canManageAttendance = hasAnyRole(authUser.role, ATTENDANCE_MANAGER_ROLES);
    const isLeaderView = authUser.role === "teamLeader";
    if (!canManageAttendance && !isLeaderView) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const parsed = attendanceListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid attendance filters" });
    }

    const scopedEmployeeIds = isLeaderView
      ? await getTeamLeaderScopedEmployeeIds(authUser.id)
      : undefined;

    const requestedEmployeeId = parsed.data.employeeId;
    if (isLeaderView && requestedEmployeeId && !scopedEmployeeIds?.includes(requestedEmployeeId)) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: parsed.data.page,
          limit: parsed.data.limit,
          totalPages: 1
        }
      });
    }

    const data = await listAttendance({
      ...parsed.data,
      employeeIds: isLeaderView ? scopedEmployeeIds : undefined
    });
    return res.status(200).json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch attendance records" });
  }
};

export const getAttendanceDashboard = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    const canManageAttendance = hasAnyRole(authUser.role, ATTENDANCE_MANAGER_ROLES);
    const isLeaderView = authUser.role === "teamLeader";
    if (!canManageAttendance && !isLeaderView) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const parsed = attendanceListQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid dashboard filters" });
    }

    const scopedEmployeeIds = isLeaderView
      ? await getTeamLeaderScopedEmployeeIds(authUser.id)
      : undefined;

    const requestedEmployeeId = parsed.data.employeeId;
    if (isLeaderView && requestedEmployeeId && !scopedEmployeeIds?.includes(requestedEmployeeId)) {
      return res.status(200).json({
        success: true,
        data: {
          totalRecords: 0,
          summary: {}
        }
      });
    }

    const data = await getAttendanceDashboardSummary({
      ...parsed.data,
      employeeIds: isLeaderView ? scopedEmployeeIds : undefined
    });

    return res.status(200).json({ success: true, data });
  } catch {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch attendance dashboard" });
  }
};

export const recomputeAttendanceByRange = async (req: Request, res: Response) => {
  try {
    const parsed = attendanceRangeRecomputeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const isLeaderView = authUser.role === "teamLeader";
    const scopedEmployeeIds = isLeaderView
      ? await getTeamLeaderScopedEmployeeIds(authUser.id)
      : undefined;

    if (isLeaderView && parsed.data.employeeId && !scopedEmployeeIds?.includes(parsed.data.employeeId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const data = await recomputeAttendanceRange({
      ...parsed.data,
      employeeIds: isLeaderView ? scopedEmployeeIds : undefined
    });
    return res.status(200).json({
      success: true,
      message: "Attendance recomputed successfully",
      data
    });
  } catch (error) {
    return res.status(resolveAttendanceErrorStatus(error)).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to recompute attendance"
    });
  }
};

export const recomputeAttendanceByEmployeeDate = async (req: Request, res: Response) => {
  try {
    const parsed = attendanceSingleRecomputeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const isLeaderView = authUser.role === "teamLeader";
    if (isLeaderView) {
      const scopedEmployeeIds = await getTeamLeaderScopedEmployeeIds(authUser.id);
      if (!scopedEmployeeIds.includes(parsed.data.employeeId)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const data = await recomputeAttendanceForEmployeeDate(parsed.data.employeeId, parsed.data.date);
    return res.status(200).json({
      success: true,
      message: "Attendance day recomputed successfully",
      data
    });
  } catch (error) {
    return res.status(resolveAttendanceErrorStatus(error)).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to recompute attendance day"
    });
  }
};

export const getAttendanceEmployees = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const canManageAttendance = hasAnyRole(authUser.role, ATTENDANCE_MANAGER_ROLES);
    const isLeaderView = authUser.role === "teamLeader";
    if (!canManageAttendance && !isLeaderView) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const scopedEmployeeIds = isLeaderView
      ? await getTeamLeaderScopedEmployeeIds(authUser.id)
      : undefined;
    const items = await listAttendanceEmployees();
    const filteredItems = scopedEmployeeIds
      ? items.filter((item) => scopedEmployeeIds.includes(String(item._id)))
      : items;

    return res.status(200).json({
      success: true,
      data: {
        items: filteredItems.map((item) => ({
          id: item._id,
          name: item.name,
          email: item.email,
          joiningDate: item.joiningDate ?? null,
          department:
            typeof item.department === "object" && item.department !== null && "name" in item.department
              ? String(item.department.name ?? "")
              : typeof item.department === "string"
                ? item.department
                : "",
          designation:
            typeof item.designation === "object" && item.designation !== null && "name" in item.designation
              ? String(item.designation.name ?? "")
              : typeof item.designation === "string"
                ? item.designation
                : ""
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch employees" });
  }
};

export const listAttendanceHolidays = async (req: Request, res: Response) => {
  try {
    const parsed = holidayListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday filters" });
    }

    await ensureHolidayIndexes();
    const items = await listHolidays(parsed.data.month, parsed.data.year);
    return res.status(200).json({
      success: true,
      data: {
        items: items.map(buildHolidayPayload)
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch holidays" });
  }
};

export const createHoliday = async (req: Request, res: Response) => {
  try {
    const parsed = holidaySchema.safeParse({
      ...req.body,
      scope: normalizeHolidayScope(typeof req.body?.scope === "string" ? req.body.scope : undefined)
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const date = startOfDay(parsed.data.date);
    const dateKey = toYmd(date);
    const department =
      parsed.data.scope === "DEPARTMENT"
        ? await validateHolidayDepartment(parsed.data.departmentId)
        : null;

    if (parsed.data.scope === "DEPARTMENT" && !department) {
      return res.status(400).json({ success: false, message: "Invalid department" });
    }

    await ensureHolidayIndexes();
    const existing = await Holiday.findOne(
      buildHolidayConflictFilter({
        dateKey,
        scope: parsed.data.scope,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null
      })
    ).lean();
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Holiday already exists for the selected date" });
    }

    const created = await Holiday.create({
      ...parsed.data,
      departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
      date,
      dateKey,
      createdBy: authUser?.id ?? null,
      updatedBy: authUser?.id ?? null
    });
    const createdWithDepartment = await Holiday.findById(created._id)
      .populate("departmentId", "name")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Holiday created successfully",
      data: buildHolidayPayload(createdWithDepartment || created)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create holiday" });
  }
};

export const updateHoliday = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday id" });
    }

    const parsed = holidaySchema.safeParse({
      ...req.body,
      scope: normalizeHolidayScope(typeof req.body?.scope === "string" ? req.body.scope : undefined)
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const date = startOfDay(parsed.data.date);
    const dateKey = toYmd(date);
    const department =
      parsed.data.scope === "DEPARTMENT"
        ? await validateHolidayDepartment(parsed.data.departmentId)
        : null;

    if (parsed.data.scope === "DEPARTMENT" && !department) {
      return res.status(400).json({ success: false, message: "Invalid department" });
    }

    await ensureHolidayIndexes();
    const conflict = await Holiday.findOne(
      buildHolidayConflictFilter({
        dateKey,
        scope: parsed.data.scope,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
        excludeId: parsedParam.data.id
      })
    ).lean();

    if (conflict) {
      return res
        .status(400)
        .json({ success: false, message: "Holiday already exists for the selected date" });
    }

    const updated = await Holiday.findByIdAndUpdate(
      parsedParam.data.id,
      {
        ...parsed.data,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
        date,
        dateKey,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after", runValidators: true }
    )
      .populate("departmentId", "name")
      .lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Holiday updated successfully",
      data: buildHolidayPayload(updated)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update holiday" });
  }
};

export const deleteHoliday = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday id" });
    }

    const deleted = await Holiday.findByIdAndDelete(parsedParam.data.id).lean();
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Holiday deleted successfully"
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete holiday" });
  }
};
