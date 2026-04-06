import AttendancePolicy from "../models/AttendancePolicy";
import AttendanceDailySummary from "../models/AttendanceDailySummary";
import Asset from "../models/Asset";
import AssetAllocation from "../models/AssetAllocation";
import Department from "../models/Department";
import LeaveBalance from "../models/LeaveBalance";
import LeaveRequest from "../models/LeaveRequest";
import Project from "../models/Project";
import Task from "../models/Task";
import User from "../models/User";
import { type AppRole } from "../constants/roles";
import { endOfDay, startOfDay } from "./leaveService";
import { syncProjectStatuses } from "./projectService";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_RANGE_DAYS = 30;
const REPORT_USER_ROLES: AppRole[] = ["employee", "HR", "teamLeader"];

type QueryValue = string | string[] | undefined;

export type ReportType = "attendance" | "leave" | "assets" | "projects" | "employees";

export type ReportSummaryCard = {
  key: string;
  label: string;
  value: number;
  tone: string;
};

export type ReportChartPoint = {
  label: string;
  value: number;
};

export type ReportTableRow = Record<string, unknown> & {
  id: string;
};

export type ReportResponse = {
  summary: ReportSummaryCard[];
  chart: ReportChartPoint[];
  items: ReportTableRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  filtersApplied: {
    fromDate: string;
    toDate: string;
    employeeId: string;
    departmentId: string;
    role: string;
    status: string;
  };
};

type ParsedFilters = {
  page: number;
  limit: number;
  fromDate: Date;
  toDate: Date;
  employeeId: string;
  departmentId: string;
  role: string;
  status: string;
};

type EmployeeOption = {
  id: string;
  name: string;
  role: AppRole;
  departmentId: string;
  departmentName: string;
};

function getPopulatedField<T extends object>(value: unknown): T | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as T;
}

function getQueryString(value: QueryValue) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInt(value: QueryValue, fallback: number) {
  const parsed = Number(getQueryString(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function formatYmd(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function parseFilters(query: Record<string, QueryValue>) {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = Math.min(parsePositiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const today = endOfDay(new Date());

  const rawFromDate = getQueryString(query.fromDate);
  const rawToDate = getQueryString(query.toDate);

  const toDate = rawToDate ? endOfDay(new Date(rawToDate)) : today;
  const fromDate = rawFromDate
    ? startOfDay(new Date(rawFromDate))
    : startOfDay(new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000));

  const normalizedFromDate = Number.isNaN(fromDate.getTime())
    ? startOfDay(new Date(today.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000))
    : fromDate;
  const normalizedToDate = Number.isNaN(toDate.getTime()) ? today : toDate > today ? today : toDate;

  return {
    page,
    limit,
    fromDate: normalizedFromDate <= normalizedToDate ? normalizedFromDate : startOfDay(normalizedToDate),
    toDate: normalizedToDate,
    employeeId: getQueryString(query.employeeId),
    departmentId: getQueryString(query.departmentId),
    role: getQueryString(query.role),
    status: getQueryString(query.status)
  } satisfies ParsedFilters;
}

function paginateItems<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  return {
    items: items.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages
  };
}

function buildResponse(
  filters: ParsedFilters,
  summary: ReportSummaryCard[],
  chart: ReportChartPoint[],
  rows: ReportTableRow[]
): ReportResponse {
  const paginated = paginateItems(rows, filters.page, filters.limit);

  return {
    summary,
    chart,
    items: paginated.items,
    total: paginated.total,
    page: paginated.page,
    limit: paginated.limit,
    totalPages: paginated.totalPages,
    filtersApplied: {
      fromDate: formatYmd(filters.fromDate),
      toDate: formatYmd(filters.toDate),
      employeeId: filters.employeeId,
      departmentId: filters.departmentId,
      role: filters.role,
      status: filters.status
    }
  };
}

async function getEmployeeOptions() {
  const users = await User.find({
    isDeleted: false,
    role: { $in: REPORT_USER_ROLES }
  })
    .select("name role department status")
    .populate("department", "name")
    .sort({ name: 1 })
    .lean();

  return users.map((user) => ({
    id: String(user._id),
    name: user.name,
    role: user.role,
    departmentId:
      user.department && typeof user.department === "object" && "_id" in user.department
        ? String(user.department._id)
        : "",
    departmentName:
      user.department && typeof user.department === "object" && "name" in user.department
        ? String(user.department.name ?? "")
        : ""
  })) satisfies EmployeeOption[];
}

function applyEmployeeFilters(options: EmployeeOption[], filters: ParsedFilters) {
  return options.filter((item) => {
    if (filters.employeeId && item.id !== filters.employeeId) return false;
    if (filters.departmentId && item.departmentId !== filters.departmentId) return false;
    if (filters.role && item.role !== filters.role) return false;
    return true;
  });
}

function getEmployeeScopeSet(options: EmployeeOption[]) {
  return new Set(options.map((item) => item.id));
}

async function getOfficeEndMinutes() {
  const policy = await AttendancePolicy.findOne({ key: "default" }).select("officeEndTime").lean();
  const officeEndTime = policy?.officeEndTime || "18:30";
  const [hours, minutes] = officeEndTime.split(":").map(Number);

  return hours * 60 + minutes;
}

export async function getReportFilterOptions() {
  const [employees, departments] = await Promise.all([
    getEmployeeOptions(),
    Department.find({ status: "Active" }).select("name").sort({ name: 1 }).lean()
  ]);

  return {
    employees,
    departments: departments.map((department) => ({
      id: String(department._id),
      name: department.name
    })),
    roles: REPORT_USER_ROLES.map((role) => ({ label: role, value: role })),
    statuses: {
      attendance: [
        "PRESENT",
        "HALF_DAY",
        "ABSENT",
        "LEAVE",
        "HOLIDAY",
        "WEEK_OFF",
        "MISSED_PUNCH",
        "HALF_DAY_LEAVE_PRESENT"
      ],
      leave: ["Pending", "Level 1 Approved", "Approved", "Rejected", "Cancelled"],
      assets: ["IN_STOCK", "ALLOCATED", "REPAIR", "RETIRED", "LOST", "UNASSIGNED", "PENDING_RETURN"],
      projects: ["active", "pending", "completed"],
      employees: ["Active", "Inactive"]
    }
  };
}

export async function getAttendanceReport(query: Record<string, QueryValue>) {
  const filters = parseFilters(query);
  const [employeeOptions, officeEndMinutes] = await Promise.all([
    getEmployeeOptions(),
    getOfficeEndMinutes()
  ]);
  const scopedEmployees = applyEmployeeFilters(employeeOptions, filters);
  const employeeIds = [...getEmployeeScopeSet(scopedEmployees)];

  if (employeeIds.length === 0 && (filters.employeeId || filters.departmentId || filters.role)) {
    return buildResponse(filters, [], [], []);
  }

  const match: Record<string, unknown> = {
    date: { $gte: filters.fromDate, $lte: filters.toDate }
  };

  if (filters.status && filters.status !== "all") {
    match.status = filters.status;
  }

  if (employeeIds.length > 0) {
    match.employeeId = { $in: employeeIds.map((id) => User.db.base.Types.ObjectId.createFromHexString(id)) };
  }

  const rows = (await AttendanceDailySummary.aggregate([
    { $match: match },
    {
      $lookup: {
        from: User.collection.name,
        localField: "employeeId",
        foreignField: "_id",
        as: "employee"
      }
    },
    { $unwind: "$employee" },
    {
      $lookup: {
        from: Department.collection.name,
        localField: "employee.department",
        foreignField: "_id",
        as: "department"
      }
    },
    {
      $unwind: {
        path: "$department",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: "$employeeId",
        employeeName: { $first: "$employee.name" },
        departmentName: { $first: "$department.name" },
        role: { $first: "$employee.role" },
        presentDays: {
          $sum: { $cond: [{ $eq: ["$status", "PRESENT"] }, 1, 0] }
        },
        absentDays: {
          $sum: { $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0] }
        },
        leaveDays: {
          $sum: { $cond: [{ $eq: ["$status", "LEAVE"] }, 1, 0] }
        },
        halfDays: {
          $sum: {
            $cond: [
              { $in: ["$status", ["HALF_DAY", "HALF_DAY_LEAVE_PRESENT"]] },
              1,
              0
            ]
          }
        },
        lateLogs: {
          $sum: { $cond: [{ $gt: ["$lateMinutes", 0] }, 1, 0] }
        },
        earlyLogs: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$lastOut", null] },
                  {
                    $lt: [
                      {
                        $add: [
                          { $multiply: [{ $hour: "$lastOut" }, 60] },
                          { $minute: "$lastOut" }
                        ]
                      },
                      officeEndMinutes
                    ]
                  },
                  { $in: ["$status", ["PRESENT", "HALF_DAY", "HALF_DAY_LEAVE_PRESENT"]] }
                ]
              },
              1,
              0
            ]
          }
        },
        missedPunchDays: {
          $sum: { $cond: [{ $eq: ["$status", "MISSED_PUNCH"] }, 1, 0] }
        },
        totalWorkMinutes: { $sum: "$totalWorkMinutes" },
        totalBreakMinutes: { $sum: "$totalBreakMinutes" },
        attendanceDays: { $sum: 1 }
      }
    },
    { $sort: { employeeName: 1 } }
  ])) as Array<Record<string, unknown>>;

  const mappedRows = rows.map((row) => ({
    id: String(row._id),
    employeeName: String(row.employeeName ?? "--"),
    departmentName: String(row.departmentName ?? "--"),
    role: String(row.role ?? "--"),
    attendanceDays: Number(row.attendanceDays ?? 0),
    presentDays: Number(row.presentDays ?? 0),
    absentDays: Number(row.absentDays ?? 0),
    leaveDays: Number(row.leaveDays ?? 0),
    halfDays: Number(row.halfDays ?? 0),
    lateLogs: Number(row.lateLogs ?? 0),
    earlyLogs: Number(row.earlyLogs ?? 0),
    missedPunchDays: Number(row.missedPunchDays ?? 0),
    totalHours: (Number(row.totalWorkMinutes ?? 0) / 60).toFixed(1),
    totalBreakHours: (Number(row.totalBreakMinutes ?? 0) / 60).toFixed(1)
  }));

  const summary = [
    {
      key: "presentDays",
      label: "Present Days",
      value: mappedRows.reduce((sum, row) => sum + Number(row.presentDays), 0),
      tone: "emerald"
    },
    {
      key: "absentDays",
      label: "Absent Days",
      value: mappedRows.reduce((sum, row) => sum + Number(row.absentDays), 0),
      tone: "rose"
    },
    {
      key: "leaveDays",
      label: "Leave Days",
      value: mappedRows.reduce((sum, row) => sum + Number(row.leaveDays), 0),
      tone: "sky"
    },
    {
      key: "halfDays",
      label: "Half Days",
      value: mappedRows.reduce((sum, row) => sum + Number(row.halfDays), 0),
      tone: "amber"
    }
  ] satisfies ReportSummaryCard[];

  const chart = [
    {
      label: "Present",
      value: mappedRows.reduce((sum, row) => sum + Number(row.presentDays), 0)
    },
    {
      label: "Absent",
      value: mappedRows.reduce((sum, row) => sum + Number(row.absentDays), 0)
    },
    {
      label: "Leave",
      value: mappedRows.reduce((sum, row) => sum + Number(row.leaveDays), 0)
    },
    {
      label: "Half Day",
      value: mappedRows.reduce((sum, row) => sum + Number(row.halfDays), 0)
    },
    {
      label: "Missed Punch",
      value: mappedRows.reduce((sum, row) => sum + Number(row.missedPunchDays), 0)
    },
    {
      label: "Late Logs",
      value: mappedRows.reduce((sum, row) => sum + Number(row.lateLogs), 0)
    },
    {
      label: "Early Logs",
      value: mappedRows.reduce((sum, row) => sum + Number(row.earlyLogs), 0)
    }
  ].filter((item) => item.value > 0);

  return buildResponse(filters, summary, chart, mappedRows);
}

export async function getLeaveReport(query: Record<string, QueryValue>) {
  const filters = parseFilters(query);
  const employeeOptions = await getEmployeeOptions();
  const scopedEmployees = applyEmployeeFilters(employeeOptions, filters);
  const scopedEmployeeIds = new Set(scopedEmployees.map((item) => item.id));
  const balanceYear = filters.toDate.getFullYear();
  type LeaveReportRow = ReportTableRow & {
    employeeName: string;
    departmentName: string;
    role: string;
    leaveType: string;
    cycleKey: string;
    allocated: number;
    used: number;
    pending: number;
    remaining: number;
    approvedDays: number;
    pendingDays: number;
    rejectedDays: number;
    approvedRequests: number;
    pendingRequests: number;
    rejectedRequests: number;
  };

  const [balances, requests] = await Promise.all([
    LeaveBalance.find({
      year: balanceYear,
      ...(scopedEmployeeIds.size > 0
        ? { employeeId: { $in: [...scopedEmployeeIds] } }
        : filters.employeeId || filters.departmentId || filters.role
          ? { employeeId: { $in: [] } }
          : {})
    })
      .populate("employeeId", "name role department")
      .populate("leaveTypeId", "name code")
      .lean(),
    LeaveRequest.find({
      fromDate: { $lte: filters.toDate },
      toDate: { $gte: filters.fromDate },
      ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
      ...(scopedEmployeeIds.size > 0
        ? { employeeId: { $in: [...scopedEmployeeIds] } }
        : filters.employeeId || filters.departmentId || filters.role
          ? { employeeId: { $in: [] } }
          : {})
    })
      .populate("employeeId", "name role department")
      .populate("leaveTypeId", "name")
      .lean()
  ]);

  const departmentMap = new Map<string, string>();
  const departments = await Department.find({}).select("name").lean();
  departments.forEach((department) => {
    departmentMap.set(String(department._id), department.name);
  });

  const requestStats = new Map<
    string,
    {
      approvedDays: number;
      pendingDays: number;
      rejectedDays: number;
      approvedRequests: number;
      pendingRequests: number;
      rejectedRequests: number;
      leaveTypeName: string;
    }
  >();

  requests.forEach((request) => {
    const employeeValue = getPopulatedField<{ _id: unknown }>(request.employeeId);
    const leaveTypeValue = getPopulatedField<{ _id: unknown; name?: string }>(request.leaveTypeId);
    const employeeId = employeeValue?._id ? String(employeeValue._id) : String(request.employeeId);
    const leaveTypeId = leaveTypeValue?._id ? String(leaveTypeValue._id) : String(request.leaveTypeId);
    const key = `${employeeId}:${leaveTypeId}`;
    const current = requestStats.get(key) || {
      approvedDays: 0,
      pendingDays: 0,
      rejectedDays: 0,
      approvedRequests: 0,
      pendingRequests: 0,
      rejectedRequests: 0,
      leaveTypeName: leaveTypeValue?.name ? String(leaveTypeValue.name) : leaveTypeId
    };

    if (request.status === "Approved") {
      current.approvedDays += Number(request.totalDays || 0);
      current.approvedRequests += 1;
    } else if (request.status === "Pending" || request.status === "Level 1 Approved") {
      current.pendingDays += Number(request.totalDays || 0);
      current.pendingRequests += 1;
    } else if (request.status === "Rejected") {
      current.rejectedDays += Number(request.totalDays || 0);
      current.rejectedRequests += 1;
    }

    requestStats.set(key, current);
  });

  const rowsByKey = new Map<string, LeaveReportRow>();

  balances
    .map((balance): LeaveReportRow => {
      const employee = getPopulatedField<{
        _id: unknown;
        name?: string;
        role?: string;
        department?: unknown;
      }>(balance.employeeId);
      const leaveType = getPopulatedField<{
        _id: unknown;
        name?: string;
      }>(balance.leaveTypeId);
      const employeeId = employee?._id ? String(employee._id) : "";
      const leaveTypeId = leaveType?._id ? String(leaveType._id) : String(balance.leaveTypeId);
      const stats = requestStats.get(`${employeeId}:${leaveTypeId}`);
      const departmentId = employee?.department ? String(employee.department) : "";

      return {
        id: `${employeeId}:${leaveTypeId}:${balance.cycleKey}`,
        employeeName: employee?.name || "--",
        departmentName: departmentMap.get(departmentId) || "--",
        role: employee?.role || "--",
        leaveType: leaveType?.name || "--",
        cycleKey: balance.cycleKey,
        allocated: Number(balance.totalAllocated || 0) + Number(balance.accrued || 0) + Number(balance.carriedForward || 0),
        used: Number(balance.used || 0),
        pending: Number(balance.pending || 0),
        remaining:
          Number(balance.totalAllocated || 0) +
          Number(balance.accrued || 0) +
          Number(balance.carriedForward || 0) -
          Number(balance.used || 0) -
          Number(balance.pending || 0),
        approvedDays: stats?.approvedDays || 0,
        pendingDays: stats?.pendingDays || 0,
        rejectedDays: stats?.rejectedDays || 0,
        approvedRequests: stats?.approvedRequests || 0,
        pendingRequests: stats?.pendingRequests || 0,
        rejectedRequests: stats?.rejectedRequests || 0
      };
    })
    .forEach((row) => {
      rowsByKey.set(String(row.id), row);
    });

  requestStats.forEach((stats, key) => {
    const [employeeId, leaveTypeId] = key.split(":");
    const alreadyExists = [...rowsByKey.keys()].some((rowKey) => rowKey.startsWith(`${employeeId}:${leaveTypeId}:`));
    if (alreadyExists) return;

    const employeeMeta = scopedEmployees.find((item) => item.id === employeeId);
    rowsByKey.set(`${employeeId}:${leaveTypeId}:request-only`, {
      id: `${employeeId}:${leaveTypeId}:request-only`,
      employeeName: employeeMeta?.name || "--",
      departmentName: employeeMeta?.departmentName || "--",
      role: employeeMeta?.role || "--",
      leaveType: stats.leaveTypeName || leaveTypeId,
      cycleKey: String(balanceYear),
      allocated: 0,
      used: 0,
      pending: 0,
      remaining: 0,
      approvedDays: stats.approvedDays,
      pendingDays: stats.pendingDays,
      rejectedDays: stats.rejectedDays,
      approvedRequests: stats.approvedRequests,
      pendingRequests: stats.pendingRequests,
      rejectedRequests: stats.rejectedRequests
    });
  });

  const rows = [...rowsByKey.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const summary = [
    {
      key: "leaveAllocated",
      label: "Allocated",
      value: rows.reduce((sum, row) => sum + row.allocated, 0),
      tone: "sky"
    },
    {
      key: "leaveUsed",
      label: "Used",
      value: rows.reduce((sum, row) => sum + row.used, 0),
      tone: "emerald"
    },
    {
      key: "leavePending",
      label: "Pending",
      value: rows.reduce((sum, row) => sum + row.pending, 0),
      tone: "amber"
    },
    {
      key: "leaveRemaining",
      label: "Remaining",
      value: rows.reduce((sum, row) => sum + row.remaining, 0),
      tone: "violet"
    }
  ] satisfies ReportSummaryCard[];

  const chartMap = new Map<string, number>();
  rows.forEach((row) => {
    chartMap.set(row.leaveType, (chartMap.get(row.leaveType) || 0) + row.used);
  });

  const chart = [...chartMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return buildResponse(filters, summary, chart, rows);
}

export async function getAssetReport(query: Record<string, QueryValue>) {
  const filters = parseFilters(query);
  const employeeOptions = await getEmployeeOptions();
  const scopedEmployees = applyEmployeeFilters(employeeOptions, filters);
  const scopedEmployeeIds = new Set(scopedEmployees.map((item) => item.id));

  const assets = await Asset.find({ isDeleted: false }).sort({ name: 1 }).lean();
  const allocations = await AssetAllocation.find({})
    .populate("employeeId", "name role department")
    .sort({ allocatedOn: -1 })
    .lean();

  const departmentMap = new Map<string, string>();
  const departments = await Department.find({}).select("name").lean();
  departments.forEach((department) => {
    departmentMap.set(String(department._id), department.name);
  });

  const latestAllocationByAsset = new Map<string, (typeof allocations)[number]>();
  allocations.forEach((allocation) => {
    const assetId = String(allocation.assetId);
    if (!latestAllocationByAsset.has(assetId)) {
      latestAllocationByAsset.set(assetId, allocation);
    }
  });

  const rows = assets
    .map((asset) => {
      const allocation = latestAllocationByAsset.get(String(asset._id));
      const employee = getPopulatedField<{
        _id: unknown;
        name?: string;
        role?: string;
        department?: unknown;
      }>(allocation?.employeeId);
      const activeEmployeeId = employee?._id ? String(employee._id) : "";
      const departmentId = employee?.department ? String(employee.department) : "";
      const isAllocated = !!allocation && !allocation.returnedOn;
      const isPendingReturn =
        isAllocated &&
        !!allocation.expectedReturnOn &&
        new Date(allocation.expectedReturnOn) < new Date();
      const derivedStatus = isPendingReturn
        ? "PENDING_RETURN"
        : isAllocated
          ? "ALLOCATED"
          : asset.status === "IN_STOCK"
            ? "UNASSIGNED"
            : asset.status;

      return {
        id: String(asset._id),
        assetCode: asset.assetCode,
        assetName: asset.name,
        category: asset.category || "--",
        brand: asset.brand || "--",
        assetStatus: derivedStatus,
        employeeId: activeEmployeeId,
        allocatedTo: employee?.name || "--",
        departmentName: departmentMap.get(departmentId) || "--",
        role: employee?.role || "--",
        allocatedOn: allocation?.allocatedOn ? formatYmd(new Date(allocation.allocatedOn)) : "--",
        expectedReturnOn: allocation?.expectedReturnOn
          ? formatYmd(new Date(allocation.expectedReturnOn))
          : "--"
      };
    })
    .filter((row) => {
      if (filters.status && filters.status !== "all" && row.assetStatus !== filters.status) {
        return false;
      }
      if ((filters.employeeId || filters.departmentId || filters.role) && row.allocatedTo === "--") {
        return false;
      }
      if (filters.employeeId && !scopedEmployeeIds.has(String(row.employeeId || ""))) {
        return false;
      }
      if (filters.departmentId && row.departmentName === "--") return false;
      if (filters.role && row.role !== filters.role) return false;
      return true;
    });

  const summary = [
    {
      key: "allocatedAssets",
      label: "Allocated",
      value: rows.filter((row) => row.assetStatus === "ALLOCATED").length,
      tone: "emerald"
    },
    {
      key: "unassignedAssets",
      label: "Unassigned",
      value: rows.filter((row) => row.assetStatus === "UNASSIGNED").length,
      tone: "sky"
    },
    {
      key: "pendingReturns",
      label: "Pending Returns",
      value: rows.filter((row) => row.assetStatus === "PENDING_RETURN").length,
      tone: "amber"
    },
    {
      key: "repairAssets",
      label: "Repair/Lost",
      value: rows.filter((row) => row.assetStatus === "REPAIR" || row.assetStatus === "LOST").length,
      tone: "rose"
    }
  ] satisfies ReportSummaryCard[];

  const chartMap = new Map<string, number>();
  rows.forEach((row) => {
    chartMap.set(row.assetStatus, (chartMap.get(row.assetStatus) || 0) + 1);
  });

  const chart = [...chartMap.entries()].map(([label, value]) => ({ label, value }));

  return buildResponse(filters, summary, chart, rows);
}

export async function getProjectReport(query: Record<string, QueryValue>) {
  const filters = parseFilters(query);
  await syncProjectStatuses();
  const employeeOptions = await getEmployeeOptions();
  const scopedEmployees = applyEmployeeFilters(employeeOptions, filters);
  const scopedEmployeeIds = new Set(scopedEmployees.map((item) => item.id));

  const projects = await Project.find({
    isDeleted: false,
    createdAt: { $gte: filters.fromDate, $lte: filters.toDate },
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {})
  })
    .populate("employees", "name role department")
    .lean();

  const tasks = await Task.find({ isDeleted: false }).lean();
  const departmentMap = new Map<string, string>();
  const departments = await Department.find({}).select("name").lean();
  departments.forEach((department) => {
    departmentMap.set(String(department._id), department.name);
  });

  const rows = projects
    .map((project) => {
      const projectTasks = tasks.filter((task) => String(task.projectId) === String(project._id));
      const relevantTasks =
        scopedEmployeeIds.size > 0
          ? projectTasks.filter((task) => scopedEmployeeIds.has(String(task.assignedTo)))
          : projectTasks;
      const teamMembers = Array.isArray(project.employees)
        ? (project.employees as Array<{ _id?: unknown; department?: unknown }>)
        : [];
      const teamSize = scopedEmployeeIds.size > 0
        ? teamMembers.filter((member) => scopedEmployeeIds.has(String(member._id))).length
        : teamMembers.length;

      const departmentNames = new Set(
        teamMembers
          .map((member) => departmentMap.get(String(member.department || "")) || "")
          .filter(Boolean)
      );
      const totalTasks = relevantTasks.length;
      const completedTasks = relevantTasks.filter((task) => task.status === "Completed").length;
      const overdueTasks = relevantTasks.filter(
        (task) => !!task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "Completed"
      ).length;

      return {
        id: String(project._id),
        projectName: project.name,
        projectStatus: project.status,
        departmentName: [...departmentNames].join(", ") || "--",
        teamSize,
        totalTasks,
        completedTasks,
        overdueTasks,
        progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
      };
    })
    .filter((row) => {
      if ((filters.employeeId || filters.departmentId || filters.role) && row.teamSize === 0) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const summary = [
    {
      key: "activeProjects",
      label: "Active Projects",
      value: rows.filter((row) => row.projectStatus === "active").length,
      tone: "emerald"
    },
    {
      key: "pendingProjects",
      label: "Pending Projects",
      value: rows.filter((row) => row.projectStatus === "pending").length,
      tone: "amber"
    },
    {
      key: "completedTasks",
      label: "Completed Tasks",
      value: rows.reduce((sum, row) => sum + row.completedTasks, 0),
      tone: "sky"
    },
    {
      key: "overdueTasks",
      label: "Overdue Tasks",
      value: rows.reduce((sum, row) => sum + row.overdueTasks, 0),
      tone: "rose"
    }
  ] satisfies ReportSummaryCard[];

  const chart = rows
    .slice()
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 6)
    .map((row) => ({
      label: row.projectName,
      value: row.progress
    }));

  return buildResponse(filters, summary, chart, rows);
}

export async function getEmployeeReport(query: Record<string, QueryValue>) {
  const filters = parseFilters(query);

  const users = await User.find({
    isDeleted: false,
    role: { $in: REPORT_USER_ROLES },
    createdAt: { $gte: filters.fromDate, $lte: filters.toDate },
    ...(filters.employeeId ? { _id: filters.employeeId } : {}),
    ...(filters.departmentId ? { department: filters.departmentId } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {})
  })
    .populate("department", "name")
    .populate("designation", "name")
    .sort({ name: 1 })
    .lean();

  const rows = users.map((user) => ({
    id: String(user._id),
    employeeName: user.name,
    email: user.email,
    role: user.role,
    departmentName:
      user.department && typeof user.department === "object" && "name" in user.department
        ? String(user.department.name ?? "--")
        : "--",
    designationName:
      user.designation && typeof user.designation === "object" && "name" in user.designation
        ? String(user.designation.name ?? "--")
        : "--",
    status: user.status,
    joinedOn: user.createdAt ? formatYmd(new Date(user.createdAt)) : "--"
  }));

  const summary = [
    {
      key: "totalUsers",
      label: "Total Users",
      value: rows.length,
      tone: "sky"
    },
    {
      key: "activeUsers",
      label: "Active",
      value: rows.filter((row) => row.status === "Active").length,
      tone: "emerald"
    },
    {
      key: "inactiveUsers",
      label: "Inactive",
      value: rows.filter((row) => row.status === "Inactive").length,
      tone: "rose"
    },
    {
      key: "hrUsers",
      label: "HR Users",
      value: rows.filter((row) => row.role === "HR").length,
      tone: "amber"
    }
  ] satisfies ReportSummaryCard[];

  const chartMap = new Map<string, number>();
  rows.forEach((row) => {
    chartMap.set(row.departmentName, (chartMap.get(row.departmentName) || 0) + 1);
  });

  const chart = [...chartMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return buildResponse(filters, summary, chart, rows);
}
