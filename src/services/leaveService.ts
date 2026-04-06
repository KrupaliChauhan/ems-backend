import LeaveBalance from "../models/LeaveBalance";
import LeaveRequest from "../models/LeaveRequest";
import LeaveType, { type LeaveType as LeaveTypeModel } from "../models/LeaveType";
import User from "../models/User";
import type mongoose from "mongoose";
import { getApplicableHolidays } from "./holidayService";
import { DEFAULT_WEEKLY_OFFS } from "../constants/calendar";
import { LEAVE_SELF_SERVICE_ROLES } from "../constants/roles";

export type LeaveAction = "approve" | "reject";
const PENDING_LEAVE_STATUSES = ["Pending", "Level 1 Approved"] as const;
const CANCELLABLE_LEAVE_STATUSES = [...PENDING_LEAVE_STATUSES, "Approved"] as const;

export type BalanceSummary = {
  totalAllocated: number;
  accrued: number;
  carriedForward: number;
  used: number;
  pending: number;
  remaining: number;
};

export function startOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function toYmd(input: Date) {
  return startOfDay(input).toISOString().slice(0, 10);
}

export function hasLeaveStarted(fromDate: Date, currentDate = new Date()) {
  return startOfDay(currentDate).getTime() >= startOfDay(fromDate).getTime();
}

export function hasLeaveDatePassed(fromDate: Date, currentDate = new Date()) {
  return startOfDay(currentDate).getTime() > startOfDay(fromDate).getTime();
}

export function getAllowedLeaveActions(status: string, fromDate: Date, currentDate = new Date()): LeaveAction[] {
  if (hasLeaveDatePassed(fromDate, currentDate)) {
    return [];
  }

  if (PENDING_LEAVE_STATUSES.includes(status as (typeof PENDING_LEAVE_STATUSES)[number])) {
    return ["approve", "reject"];
  }

  return [];
}

export function canCancelLeaveRequest(status: string, fromDate: Date, currentDate = new Date()) {
  if (hasLeaveStarted(fromDate, currentDate)) {
    return false;
  }

  return CANCELLABLE_LEAVE_STATUSES.includes(status as (typeof CANCELLABLE_LEAVE_STATUSES)[number]);
}

export function getCycleParts(date: Date, allocationPeriod: "yearly" | "monthly") {
  const year = date.getFullYear();
  const month = allocationPeriod === "monthly" ? date.getMonth() + 1 : null;
  const cycleKey = allocationPeriod === "monthly" ? `${year}-${String(month).padStart(2, "0")}` : `${year}`;
  return { year, month, cycleKey };
}

export function getPreviousCycle(date: Date, allocationPeriod: "yearly" | "monthly") {
  if (allocationPeriod === "monthly") {
    const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return getCycleParts(previous, "monthly");
  }

  const previous = new Date(date.getFullYear() - 1, 0, 1);
  return getCycleParts(previous, "yearly");
}

export function getRemainingBalance(summary: {
  totalAllocated: number;
  accrued: number;
  carriedForward: number;
  used: number;
  pending: number;
}) {
  return Number(
    (summary.totalAllocated + summary.accrued + summary.carriedForward - summary.used - summary.pending).toFixed(2)
  );
}

export function buildBalanceSummary(balance: {
  totalAllocated: number;
  accrued: number;
  carriedForward: number;
  used: number;
  pending: number;
}): BalanceSummary {
  return {
    totalAllocated: balance.totalAllocated,
    accrued: balance.accrued,
    carriedForward: balance.carriedForward,
    used: balance.used,
    pending: balance.pending,
    remaining: getRemainingBalance(balance)
  };
}

export async function getHolidayDateKeysInRange(fromDate: Date, toDate: Date, departmentId?: string | null) {
  const holidays = await getApplicableHolidays({
    fromDate,
    toDate,
    departmentId: departmentId ?? null
  });

  return new Set(holidays.map((holiday) => holiday.dateKey));
}

export function calculateLeaveDays(
  fromDate: Date,
  toDate: Date,
  dayUnit: "FULL" | "HALF",
  holidayDateKeys: Set<string> = new Set(),
  weeklyOffs: readonly number[] = DEFAULT_WEEKLY_OFFS
) {
  const from = startOfDay(fromDate);
  const to = startOfDay(toDate);

  if (from > to) {
    throw new Error("From date cannot be after to date");
  }

  if (dayUnit === "HALF") {
    if (from.getTime() !== to.getTime()) {
      throw new Error("Half day leave can only be applied for a single date");
    }
    const dayOfWeek = from.getDay();
    if (weeklyOffs.includes(dayOfWeek)) return 0;
    if (holidayDateKeys.has(toYmd(from))) return 0;
    return 0.5;
  }

  let totalDays = 0;
  const current = new Date(from);

  while (current <= to) {
    const dayOfWeek = current.getDay();
    const dateKey = toYmd(current);
    if (!weeklyOffs.includes(dayOfWeek) && !holidayDateKeys.has(dateKey)) {
      totalDays += 1;
    }
    current.setDate(current.getDate() + 1);
  }

  return totalDays;
}

async function findCarryForwardAmount(
  employeeId: string,
  leaveType: LeaveTypeModel & { _id: any },
  cycleDate: Date,
  session?: mongoose.ClientSession
) {
  if (!leaveType.carryForwardEnabled) return { amount: 0, sourceCycleKey: null as string | null };

  const previousCycle = getPreviousCycle(cycleDate, leaveType.allocationPeriod);
  const previous = await LeaveBalance.findOne({
    employeeId,
    leaveTypeId: leaveType._id,
    cycleKey: previousCycle.cycleKey
  })
    .session(session ?? null)
    .lean();

  if (!previous) {
    return { amount: 0, sourceCycleKey: null as string | null };
  }

  const remaining = getRemainingBalance(previous);
  const amount = Math.max(0, Math.min(remaining, leaveType.maxCarryForwardLimit || 0));

  return {
    amount: Number(amount.toFixed(2)),
    sourceCycleKey: amount > 0 ? previous.cycleKey : null
  };
}

export async function ensureLeaveBalance(params: {
  employeeId: string;
  leaveType: LeaveTypeModel & { _id: any };
  cycleDate: Date;
  session?: mongoose.ClientSession;
}) {
  const { employeeId, leaveType, cycleDate, session } = params;
  const cycle = getCycleParts(cycleDate, leaveType.allocationPeriod);

  let balance = await LeaveBalance.findOne({
    employeeId,
    leaveTypeId: leaveType._id,
    cycleKey: cycle.cycleKey
  }).session(session ?? null);

  if (balance) {
    return balance;
  }

  const carryForward = await findCarryForwardAmount(employeeId, leaveType, cycleDate, session);

  const created = await LeaveBalance.create(
    [
      {
        employeeId,
        leaveTypeId: leaveType._id,
        year: cycle.year,
        month: cycle.month,
        cycleKey: cycle.cycleKey,
        totalAllocated: leaveType.totalAllocation,
        accrued: 0,
        carriedForward: carryForward.amount,
        used: 0,
        pending: 0,
        processedAccrualPeriods: [],
        carryForwardSourceCycleKey: carryForward.sourceCycleKey,
        lastCarryForwardRunAt: new Date()
      }
    ],
    { session }
  );

  return created[0];
}

export async function validateEmployeeAccess(employeeId: string) {
  return User.findOne({
    _id: employeeId,
    role: { $in: LEAVE_SELF_SERVICE_ROLES },
    status: "Active",
    isDeleted: false
  })
    .select("_id name email department designation")
    .lean();
}

export async function ensureNoOverlap(params: {
  employeeId: string;
  fromDate: Date;
  toDate: Date;
  excludeRequestId?: string;
}) {
  const filter: Record<string, unknown> = {
    employeeId: params.employeeId,
    status: { $in: ["Pending", "Level 1 Approved", "Approved"] },
    fromDate: { $lte: endOfDay(params.toDate) },
    toDate: { $gte: startOfDay(params.fromDate) }
  };

  if (params.excludeRequestId) {
    filter._id = { $ne: params.excludeRequestId };
  }

  const overlapping = await LeaveRequest.findOne(filter).select("_id").lean();
  return !overlapping;
}

export async function processMonthlyAccrual(runDate: Date) {
  const runAt = startOfDay(runDate);
  const periodKey = `${runAt.getFullYear()}-${String(runAt.getMonth() + 1).padStart(2, "0")}`;

  const [leaveTypes, employees] = await Promise.all([
    LeaveType.find({
      isDeleted: false,
      status: "Active",
      accrualEnabled: true,
      accrualAmount: { $gt: 0 },
      accrualFrequency: "monthly"
    }).lean(),
    User.find({ role: { $in: LEAVE_SELF_SERVICE_ROLES }, status: "Active", isDeleted: false }).select("_id").lean()
  ]);

  let processedBalances = 0;

  for (const leaveType of leaveTypes) {
    for (const employee of employees) {
      const balance = await ensureLeaveBalance({
        employeeId: String(employee._id),
        leaveType,
        cycleDate: runAt
      });

      const alreadyProcessed = (balance.processedAccrualPeriods || []).includes(periodKey);
      if (alreadyProcessed) continue;

      balance.accrued = Number((balance.accrued + leaveType.accrualAmount).toFixed(2));
      balance.processedAccrualPeriods = [...(balance.processedAccrualPeriods || []), periodKey];
      balance.lastAccrualRunAt = new Date();
      await balance.save();
      processedBalances += 1;
    }
  }

  return {
    processedBalances,
    processedLeaveTypes: leaveTypes.length,
    processedEmployees: employees.length,
    periodKey
  };
}

export async function processCarryForward(runDate: Date) {
  const target = startOfDay(runDate);

  const [leaveTypes, employees] = await Promise.all([
    LeaveType.find({
      isDeleted: false,
      status: "Active",
      carryForwardEnabled: true,
      maxCarryForwardLimit: { $gt: 0 }
    }).lean(),
    User.find({ role: { $in: LEAVE_SELF_SERVICE_ROLES }, status: "Active", isDeleted: false }).select("_id").lean()
  ]);

  let processedBalances = 0;

  for (const leaveType of leaveTypes) {
    for (const employee of employees) {
      const existing = await LeaveBalance.findOne({
        employeeId: employee._id,
        leaveTypeId: leaveType._id,
        cycleKey: getCycleParts(target, leaveType.allocationPeriod).cycleKey
      }).lean();

      if (existing) continue;

      await ensureLeaveBalance({
        employeeId: String(employee._id),
        leaveType,
        cycleDate: target
      });
      processedBalances += 1;
    }
  }

  return {
    processedBalances,
    processedLeaveTypes: leaveTypes.length,
    processedEmployees: employees.length
  };
}

export async function purgeExpiredUnapprovedLeaveRequests(currentDate = new Date()) {
  const today = startOfDay(currentDate);
  const expiredRequests = await LeaveRequest.find({
    fromDate: { $lt: today },
    status: { $in: PENDING_LEAVE_STATUSES }
  })
    .select("_id employeeId leaveTypeId balanceCycleKey totalDays status")
    .lean();

  if (expiredRequests.length === 0) {
    return { deletedCount: 0 };
  }

  const pendingAdjustments = new Map<
    string,
    { employeeId: string; leaveTypeId: string; cycleKey: string; totalDays: number }
  >();

  expiredRequests.forEach((request) => {
    if (!PENDING_LEAVE_STATUSES.includes(request.status as (typeof PENDING_LEAVE_STATUSES)[number])) {
      return;
    }

    const employeeId = String(request.employeeId);
    const leaveTypeId = String(request.leaveTypeId);
    const cycleKey = request.balanceCycleKey;
    const key = `${employeeId}:${leaveTypeId}:${cycleKey}`;
    const current = pendingAdjustments.get(key);

    if (current) {
      current.totalDays = Number((current.totalDays + request.totalDays).toFixed(2));
      return;
    }

    pendingAdjustments.set(key, {
      employeeId,
      leaveTypeId,
      cycleKey,
      totalDays: request.totalDays
    });
  });

  for (const adjustment of pendingAdjustments.values()) {
    const balance = await LeaveBalance.findOne({
      employeeId: adjustment.employeeId,
      leaveTypeId: adjustment.leaveTypeId,
      cycleKey: adjustment.cycleKey
    });

    if (!balance) {
      continue;
    }

    balance.pending = Math.max(0, Number((balance.pending - adjustment.totalDays).toFixed(2)));
    await balance.save();
  }

  await LeaveRequest.deleteMany({
    _id: { $in: expiredRequests.map((request) => request._id) }
  });

  return { deletedCount: expiredRequests.length };
}
