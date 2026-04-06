import Department from "../models/Department";
import Holiday from "../models/Holiday";
import {
  buildApplicableHolidayFilter,
  getEffectiveHolidayScope,
  normalizeHolidayScope,
  type HolidayScope
} from "../utils/holidayScope";
import { endOfDay, startOfDay } from "./leaveService";

export async function validateHolidayDepartment(departmentId?: string | null) {
  if (!departmentId) return null;

  return Department.findOne({
    _id: departmentId,
    isDeleted: false,
    status: "Active"
  })
    .select("_id name")
    .lean();
}

export async function getApplicableHolidays(params: {
  fromDate: Date;
  toDate: Date;
  departmentId?: string | null;
}) {
  return Holiday.find(
    buildApplicableHolidayFilter({
      fromDate: startOfDay(params.fromDate),
      toDate: endOfDay(params.toDate),
      departmentId: params.departmentId ?? null,
      isActive: true
    })
  )
    .populate("departmentId", "name")
    .sort({ date: 1, name: 1 })
    .lean();
}

export async function getApplicableHolidayByDate(params: {
  dateKey: string;
  departmentId?: string | null;
}) {
  return Holiday.findOne(
    buildApplicableHolidayFilter({
      dateKey: params.dateKey,
      departmentId: params.departmentId ?? null,
      isActive: true
    })
  )
    .select("_id name scope departmentId")
    .populate("departmentId", "name")
    .sort({ scope: 1 })
    .lean();
}

export async function listScopedHolidays(params: {
  month?: number;
  year?: number;
  search?: string;
  scope?: HolidayScope | "";
  isActive?: "all" | "true" | "false";
}) {
  const filter: Record<string, unknown> = {};

  if (params.search) {
    filter.name = { $regex: params.search, $options: "i" };
  }

  if (params.scope === "COMPANY") {
    filter.$or = [
      { scope: { $regex: /^(company|all|global|branch|office|COMPANY)$/i } },
      { scope: { $regex: /^(department|dept|DEPARTMENT)$/i }, $or: [{ departmentId: null }, { departmentId: { $exists: false } }] }
    ];
  } else if (params.scope === "DEPARTMENT") {
    filter.scope = { $regex: /^(department|dept|DEPARTMENT)$/i };
    filter.departmentId = { $ne: null };
  }

  if (params.isActive && params.isActive !== "all") {
    filter.isActive = params.isActive === "true";
  }

  if (params.month && params.year) {
    filter.date = {
      $gte: new Date(params.year, params.month - 1, 1),
      $lte: new Date(params.year, params.month, 0, 23, 59, 59, 999)
    };
  }

  return Holiday.find(filter)
    .populate("departmentId", "name")
    .sort({ date: 1, name: 1 })
    .lean();
}

export function buildHolidayPayload(item: {
  _id: unknown;
  name: string;
  date: Date;
  dateKey: string;
  description?: string | null;
  scope?: string | null;
  isActive: boolean;
  departmentId?: unknown;
}) {
  const scope = getEffectiveHolidayScope(item);
  const departmentRecord =
    typeof item.departmentId === "object" && item.departmentId !== null ? (item.departmentId as Record<string, unknown>) : null;
  const departmentId =
    departmentRecord && "_id" in departmentRecord
      ? String(departmentRecord._id || "")
      : item.departmentId
        ? String(item.departmentId)
        : "";
  const departmentName =
    departmentRecord && "name" in departmentRecord ? String(departmentRecord.name || "") : "";

  return {
    id: String(item._id),
    name: item.name,
    date: item.date,
    dateKey: item.dateKey,
    description: item.description || "",
    scope: normalizeHolidayScope(scope),
    isActive: item.isActive,
    departmentId: scope === "DEPARTMENT" ? departmentId || null : null,
    departmentName: scope === "DEPARTMENT" ? departmentName || "" : ""
  };
}
