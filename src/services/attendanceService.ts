import mongoose from "mongoose";
import AttendancePolicy, {
  ATTENDANCE_WEEKDAY_VALUES,
  type AttendancePolicyDocument
} from "../models/AttendancePolicy";
import AttendancePunch from "../models/AttendancePunch";
import AttendanceDailySummary, { type AttendanceStatus } from "../models/AttendanceDailySummary";
import Holiday from "../models/Holiday";
import LeaveRequest from "../models/LeaveRequest";
import User from "../models/User";
import { endOfDay, startOfDay, toYmd } from "./leaveService";
import { SELF_ATTENDANCE_ROLES, hasAnyRole } from "../constants/roles";
import { getApplicableHolidayByDate, getApplicableHolidays } from "./holidayService";
import { DEFAULT_WEEKLY_OFFS } from "../constants/calendar";
import { buildActiveUserFilter } from "./userService";

type PolicySnapshot = {
  officeStartTime: string;
  officeEndTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: Array<(typeof ATTENDANCE_WEEKDAY_VALUES)[number]>;
  multiplePunchAllowed: boolean;
  enableHolidayIntegration: boolean;
  enableLeaveIntegration: boolean;
};

type PunchComputation = {
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
  missedPunch: boolean;
  hasOpenPunchSession: boolean;
  remarks: string[];
};

type AttendancePunchLike = {
  punchTime: Date;
  punchType: "IN" | "OUT";
};

type LeaveResolution = {
  isFullDayLeave: boolean;
  isHalfDayLeave: boolean;
  leaveId: string | null;
};

type MonthlyLeaveRecord = {
  _id: unknown;
  fromDate: Date;
  toDate: Date;
  dayUnit: "FULL" | "HALF";
};

type MonthlyHolidayRecord = {
  _id: unknown;
  dateKey: string;
  name?: string;
};

type AttendanceEmployeeRecord = {
  _id: mongoose.Types.ObjectId;
  department?: mongoose.Types.ObjectId | null;
  joiningDate?: Date | null;
  status?: string;
  isActive?: boolean;
};

export type AttendanceDayUiStatus =
  | "HOLIDAY"
  | "LEAVE"
  | "WEEK_OFF"
  | "NOT_STARTED"
  | "MISSED_PUNCH"
  | "LATE"
  | "HALF_DAY"
  | "ABSENT"
  | "PRESENT"
  | "IN_PROGRESS";

type AttendanceDayUiEvaluation = {
  status: AttendanceDayUiStatus;
  shiftStartTime: Date;
  lateThresholdTime: Date;
  halfDayTime: Date;
};

export class AttendanceServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function buildDefaultAttendancePolicy(): PolicySnapshot {
  return {
    officeStartTime: "09:30",
    officeEndTime: "18:30",
    graceMinutes: 15,
    halfDayMinutes: 240,
    fullDayMinutes: 480,
    weeklyOffs: [...DEFAULT_WEEKLY_OFFS],
    multiplePunchAllowed: true,
    enableHolidayIntegration: true,
    enableLeaveIntegration: true
  };
}

export async function ensureAttendancePolicy() {
  let policy = await AttendancePolicy.findOne({ key: "default" });
  if (!policy) {
    policy = await AttendancePolicy.create({
      key: "default",
      ...buildDefaultAttendancePolicy()
    });
  } else {
    const normalizedWeeklyOffs = [...new Set(policy.weeklyOffs)].sort((a, b) => a - b);
    const shouldUpgradeWeeklyOffs =
      normalizedWeeklyOffs.length === 0 ||
      (normalizedWeeklyOffs.length === 1 && normalizedWeeklyOffs[0] === 0);

    if (shouldUpgradeWeeklyOffs) {
      policy.weeklyOffs = [...DEFAULT_WEEKLY_OFFS];
      await policy.save();
    }
  }
  return policy;
}

export function getPolicySnapshot(
  policy: AttendancePolicyDocument | PolicySnapshot
): PolicySnapshot {
  return {
    officeStartTime: policy.officeStartTime,
    officeEndTime: policy.officeEndTime,
    graceMinutes: policy.graceMinutes,
    halfDayMinutes: policy.halfDayMinutes,
    fullDayMinutes: policy.fullDayMinutes,
    weeklyOffs: [...policy.weeklyOffs].sort((a, b) => a - b),
    multiplePunchAllowed: policy.multiplePunchAllowed,
    enableHolidayIntegration: policy.enableHolidayIntegration,
    enableLeaveIntegration: policy.enableLeaveIntegration
  };
}

function getMinutesFromTimeString(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getMinutesSinceDayStart(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

function differenceInMinutes(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (1000 * 60)));
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function applyTimeToDate(date: Date, time: string) {
  const minutes = getMinutesFromTimeString(time);
  const next = startOfDay(date);
  next.setMinutes(minutes);
  return next;
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getMonthRange(year: number, month: number) {
  const fromDate = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const todayEnd = endOfDay(new Date());

  if (fromDate > todayEnd) {
    return { fromDate, toDate: endOfDay(new Date(fromDate.getTime() - 24 * 60 * 60 * 1000)) };
  }

  return {
    fromDate,
    toDate: monthEnd > todayEnd ? todayEnd : monthEnd
  };
}

function resolveJoiningDate(joiningDate?: Date | null) {
  return joiningDate ? startOfDay(joiningDate) : null;
}

function isBeforeJoiningDate(date: Date, joiningDate?: Date | null) {
  const normalizedJoiningDate = resolveJoiningDate(joiningDate);
  if (!normalizedJoiningDate) {
    return false;
  }

  return startOfDay(date).getTime() < normalizedJoiningDate.getTime();
}

function isFutureAttendanceDate(date: Date) {
  return startOfDay(date).getTime() > startOfDay(new Date()).getTime();
}

async function getAttendanceEmployee(employeeId: string) {
  return User.findOne({
    _id: employeeId,
    role: { $in: SELF_ATTENDANCE_ROLES },
    isDeleted: false
  })
    .select("_id department joiningDate status isActive")
    .lean<AttendanceEmployeeRecord | null>();
}

async function resolveApprovedLeave(employeeId: string, date: Date): Promise<LeaveResolution> {
  const leave = await LeaveRequest.findOne({
    employeeId,
    status: "Approved",
    fromDate: { $lte: endOfDay(date) },
    toDate: { $gte: startOfDay(date) }
  })
    .sort({ createdAt: -1 })
    .select("_id dayUnit")
    .lean();

  if (!leave) {
    return { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null };
  }

  return {
    isFullDayLeave: leave.dayUnit === "FULL",
    isHalfDayLeave: leave.dayUnit === "HALF",
    leaveId: String(leave._id)
  };
}

async function resolveHoliday(dateKey: string, departmentId?: string | null) {
  return getApplicableHolidayByDate({
    dateKey,
    departmentId: departmentId ?? null
  });
}

export function computePunchMetrics(punches: AttendancePunchLike[]): PunchComputation {
  const sortedPunches = [...punches].sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  let currentIn: Date | null = null;
  let totalWorkMinutes = 0;
  let totalBreakMinutes = 0;
  let missedPunch = false;
  const remarks: string[] = [];

  for (const punch of sortedPunches) {
    if (punch.punchType === "IN") {
      if (!firstIn) {
        firstIn = punch.punchTime;
      }

      if (currentIn) {
        missedPunch = true;
        remarks.push("Consecutive IN punches detected");
      }

      if (lastOut && punch.punchTime > lastOut) {
        totalBreakMinutes += differenceInMinutes(lastOut, punch.punchTime);
      }

      currentIn = punch.punchTime;
      continue;
    }

    if (!currentIn) {
      missedPunch = true;
      remarks.push("OUT punch found without matching IN");
      continue;
    }

    if (punch.punchTime <= currentIn) {
      missedPunch = true;
      remarks.push("OUT punch is earlier than IN punch");
      continue;
    }

    totalWorkMinutes += differenceInMinutes(currentIn, punch.punchTime);
    lastOut = punch.punchTime;
    currentIn = null;
  }

  if (currentIn) {
    missedPunch = true;
    remarks.push("Open IN punch without matching OUT");
  }

  return {
    totalWorkMinutes,
    totalBreakMinutes,
    firstIn,
    lastOut,
    missedPunch,
    hasOpenPunchSession: !!currentIn,
    remarks
  };
}

export function resolveAttendanceStatus(params: {
  policy: PolicySnapshot;
  punches: AttendancePunchLike[];
  work: PunchComputation;
  leave: LeaveResolution;
  holidayId: string | null;
  isWeeklyOff: boolean;
}): {
  status: AttendanceStatus;
  lateMinutes: number;
  remarks: string;
} {
  const { policy, punches, work, leave, holidayId, isWeeklyOff } = params;

  if (holidayId) {
    return { status: "HOLIDAY", lateMinutes: 0, remarks: "Holiday applied" };
  }

  if (isWeeklyOff) {
    return { status: "WEEK_OFF", lateMinutes: 0, remarks: "Weekly off applied" };
  }

  if (leave.isFullDayLeave) {
    return { status: "LEAVE", lateMinutes: 0, remarks: "Approved leave applied" };
  }

  const lateMinutes = work.firstIn
    ? Math.max(
        0,
        getMinutesSinceDayStart(work.firstIn) -
          (getMinutesFromTimeString(policy.officeStartTime) + policy.graceMinutes)
      )
    : 0;

  if (leave.isHalfDayLeave) {
    if (work.totalWorkMinutes >= policy.halfDayMinutes && !work.missedPunch) {
      return {
        status: "HALF_DAY_LEAVE_PRESENT",
        lateMinutes,
        remarks: "Approved half-day leave with attendance"
      };
    }

    if (punches.length > 0 && work.missedPunch) {
      return {
        status: "MISSED_PUNCH",
        lateMinutes,
        remarks: work.remarks.join("; ") || "Missed punch"
      };
    }

    return { status: "HALF_DAY", lateMinutes, remarks: "Approved half-day leave" };
  }

  if (work.totalWorkMinutes >= policy.fullDayMinutes && !work.missedPunch) {
    return { status: "PRESENT", lateMinutes, remarks: "Present" };
  }

  if (work.totalWorkMinutes >= policy.halfDayMinutes && !work.missedPunch) {
    return { status: "HALF_DAY", lateMinutes, remarks: "Half day" };
  }

  if (punches.length > 0 && work.missedPunch) {
    return {
      status: "MISSED_PUNCH",
      lateMinutes,
      remarks: work.remarks.join("; ") || "Missed punch"
    };
  }

  return { status: "ABSENT", lateMinutes, remarks: "Absent" };
}

export function resolveAttendanceDayUiStatus(params: {
  date: Date;
  policy: PolicySnapshot;
  punches: AttendancePunchLike[];
  work: PunchComputation;
  leave: LeaveResolution;
  holidayId: string | null;
  isWeeklyOff: boolean;
  now?: Date;
}): AttendanceDayUiEvaluation {
  const { date, policy, punches, work, leave, holidayId, isWeeklyOff } = params;
  const now = params.now ?? new Date();
  const shiftStartTime = applyTimeToDate(date, policy.officeStartTime);
  const lateThresholdTime = addMinutes(shiftStartTime, policy.graceMinutes);
  const halfDayTime = addMinutes(shiftStartTime, policy.halfDayMinutes);
  const shiftEndTime = applyTimeToDate(date, policy.officeEndTime);
  const evaluationTime = isSameCalendarDay(date, now) ? now : endOfDay(date);

  if (holidayId) {
    return { status: "HOLIDAY", shiftStartTime, lateThresholdTime, halfDayTime };
  }

  if (isWeeklyOff) {
    return { status: "WEEK_OFF", shiftStartTime, lateThresholdTime, halfDayTime };
  }

  if (leave.isFullDayLeave) {
    return { status: "LEAVE", shiftStartTime, lateThresholdTime, halfDayTime };
  }

  if (!work.firstIn) {
    if (evaluationTime > halfDayTime) {
      return { status: "ABSENT", shiftStartTime, lateThresholdTime, halfDayTime };
    }

    if (evaluationTime > lateThresholdTime) {
      return { status: "MISSED_PUNCH", shiftStartTime, lateThresholdTime, halfDayTime };
    }

    return { status: "NOT_STARTED", shiftStartTime, lateThresholdTime, halfDayTime };
  }

  const isLatePunchIn = work.firstIn.getTime() > lateThresholdTime.getTime();

  if (work.hasOpenPunchSession) {
    if (evaluationTime > shiftEndTime) {
      return {
        status: "MISSED_PUNCH",
        shiftStartTime,
        lateThresholdTime,
        halfDayTime
      };
    }

    return {
      status: "IN_PROGRESS",
      shiftStartTime,
      lateThresholdTime,
      halfDayTime
    };
  }

  if (work.lastOut) {
    if (evaluationTime > halfDayTime && work.totalWorkMinutes < policy.fullDayMinutes) {
      return { status: "HALF_DAY", shiftStartTime, lateThresholdTime, halfDayTime };
    }

    if (work.totalWorkMinutes >= policy.fullDayMinutes) {
      return {
        status: isLatePunchIn ? "LATE" : "PRESENT",
        shiftStartTime,
        lateThresholdTime,
        halfDayTime
      };
    }

    return {
      status: "PRESENT",
      shiftStartTime,
      lateThresholdTime,
      halfDayTime
    };
  }

  return {
    status: "PRESENT",
    shiftStartTime,
    lateThresholdTime,
    halfDayTime
  };
}

function resolveApprovedLeaveFromRecords(
  leaves: MonthlyLeaveRecord[],
  date: Date
): LeaveResolution {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const leave = leaves.find((item) => item.fromDate <= dayEnd && item.toDate >= dayStart);

  if (!leave) {
    return { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null };
  }

  return {
    isFullDayLeave: leave.dayUnit === "FULL",
    isHalfDayLeave: leave.dayUnit === "HALF",
    leaveId: String(leave._id)
  };
}

function buildAttendanceSummaryPayload(params: {
  employeeId: string;
  date: Date;
  policy: PolicySnapshot;
  punches: AttendancePunchLike[];
  leave: LeaveResolution;
  holiday: MonthlyHolidayRecord | null;
}) {
  const { employeeId, date, policy, punches, leave, holiday } = params;
  const dateKey = toYmd(date);
  const work = computePunchMetrics(punches);
  const isWeeklyOff = policy.weeklyOffs.includes(
    date.getDay() as (typeof ATTENDANCE_WEEKDAY_VALUES)[number]
  );
  const resolved = resolveAttendanceStatus({
    policy,
    punches,
    work,
    leave,
    holidayId: holiday ? String(holiday._id) : null,
    isWeeklyOff
  });

  return {
    employeeId,
    date,
    dateKey,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    totalWorkMinutes: work.totalWorkMinutes,
    totalBreakMinutes: work.totalBreakMinutes,
    firstIn: work.firstIn,
    lastOut: work.lastOut,
    status: resolved.status,
    lateMinutes: resolved.lateMinutes,
    isHalfDayLeave: leave.isHalfDayLeave,
    leaveId: leave.leaveId,
    holidayId: holiday ? holiday._id : null,
    weeklyOffApplied: !holiday && isWeeklyOff,
    remarks: resolved.remarks,
    missedPunch: work.missedPunch,
    punchCount: punches.length
  };
}

export async function recomputeAttendanceForEmployeeDate(employeeId: string, inputDate: Date) {
  const policy = getPolicySnapshot(await ensureAttendancePolicy());
  const date = startOfDay(inputDate);
  const dateKey = toYmd(date);
  const employee = await getAttendanceEmployee(employeeId);

  if (!employee) {
    throw new AttendanceServiceError(404, "Employee not found");
  }

  if (isFutureAttendanceDate(date)) {
    await AttendanceDailySummary.deleteOne({ employeeId, dateKey });
    return {
      employeeId,
      dateKey,
      skipped: true,
      reason: "future_date"
    };
  }

  if (isBeforeJoiningDate(date, employee.joiningDate)) {
    await AttendanceDailySummary.deleteOne({ employeeId, dateKey });
    return {
      employeeId,
      dateKey,
      skipped: true,
      joiningDate: employee.joiningDate ?? null
    };
  }

  const punches = await AttendancePunch.find({
    employeeId,
    dateKey
  }).sort({ punchTime: 1 });

  const leave = policy.enableLeaveIntegration
    ? await resolveApprovedLeave(employeeId, date)
    : { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null };
  const holiday = policy.enableHolidayIntegration
    ? await resolveHoliday(dateKey, employee?.department ? String(employee.department) : null)
    : null;
  const payload = buildAttendanceSummaryPayload({
    employeeId,
    date,
    policy,
    punches,
    leave,
    holiday: holiday ? { _id: holiday._id, dateKey, name: holiday.name } : null
  });

  await AttendanceDailySummary.findOneAndUpdate({ employeeId, dateKey }, payload, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
    runValidators: true
  });

  return {
    employeeId,
    dateKey,
    status: payload.status
  };
}

export async function recomputeAttendanceRange(params: {
  employeeId?: string;
  employeeIds?: string[];
  fromDate: Date;
  toDate: Date;
}) {
  const fromDate = startOfDay(params.fromDate);
  const requestedToDate = startOfDay(params.toDate);
  const today = startOfDay(new Date());
  const toDate = requestedToDate > today ? today : requestedToDate;

  if (fromDate > toDate) {
    throw new Error("From date cannot be after to date");
  }

  const employees = params.employeeId
    ? await User.find({
        _id: params.employeeId,
        role: { $in: SELF_ATTENDANCE_ROLES },
        isDeleted: false
      })
        .select("_id joiningDate")
        .lean()
    : params.employeeIds
      ? await User.find({
          _id: { $in: params.employeeIds.length > 0 ? params.employeeIds : [new mongoose.Types.ObjectId()] },
          role: { $in: SELF_ATTENDANCE_ROLES },
          isDeleted: false,
          ...buildActiveUserFilter(true)
        })
          .select("_id joiningDate")
          .lean()
    : await User.find({
        role: { $in: SELF_ATTENDANCE_ROLES },
        isDeleted: false,
        ...buildActiveUserFilter(true)
      })
        .select("_id joiningDate")
        .lean();

  let processed = 0;
  for (const employee of employees) {
    const effectiveFromDate = resolveJoiningDate((employee as { joiningDate?: Date | null }).joiningDate);
    const current = effectiveFromDate && effectiveFromDate > fromDate ? new Date(effectiveFromDate) : new Date(fromDate);
    while (current <= toDate) {
      await recomputeAttendanceForEmployeeDate(String(employee._id), current);
      processed += 1;
      current.setDate(current.getDate() + 1);
    }
  }

  return {
    employeesProcessed: employees.length,
    attendanceDaysProcessed: processed
  };
}

export async function addAttendancePunch(params: {
  employeeId: string;
  punchTime: Date;
  punchType: "IN" | "OUT";
  source: "web" | "manual";
  remarks: string;
  createdBy?: string | null;
  actorRole?: string;
}) {
  const isSelfPunch = !!params.createdBy && String(params.createdBy) === String(params.employeeId);
  const employee = await User.findOne({
    _id: params.employeeId,
    role:
      isSelfPunch && hasAnyRole(params.actorRole, SELF_ATTENDANCE_ROLES)
        ? { $in: SELF_ATTENDANCE_ROLES }
        : { $in: SELF_ATTENDANCE_ROLES },
    isDeleted: false,
    ...buildActiveUserFilter(true)
  })
    .select("_id joiningDate")
    .lean();

  if (!employee) {
    throw new AttendanceServiceError(404, "Employee not found");
  }

  const policy = getPolicySnapshot(await ensureAttendancePolicy());
  const date = startOfDay(params.punchTime);
  const dateKey = toYmd(date);
  const now = new Date();

  if (params.punchTime.getTime() > now.getTime()) {
    throw new AttendanceServiceError(422, "Future attendance punches are not allowed");
  }

  if (isBeforeJoiningDate(date, employee.joiningDate)) {
    throw new AttendanceServiceError(
      422,
      `Attendance cannot be recorded before the employee's joining date (${toYmd(employee.joiningDate as Date)})`
    );
  }

  const existingPunches = await AttendancePunch.find({
    employeeId: params.employeeId,
    dateKey
  })
    .sort({ punchTime: 1 })
    .lean();

  if (policy.enableLeaveIntegration) {
    const leave = await resolveApprovedLeave(params.employeeId, date);
    if (leave.isFullDayLeave) {
      throw new AttendanceServiceError(409, "Punch in and punch out are disabled on approved leave dates");
    }
  }

  if (!policy.multiplePunchAllowed && existingPunches.length >= 2) {
    throw new AttendanceServiceError(409, "Multiple punch is disabled in attendance policy");
  }

  validatePunchSequence(existingPunches, {
    punchType: params.punchType,
    punchTime: params.punchTime
  });

  const created = await AttendancePunch.create({
    employeeId: params.employeeId,
    date,
    dateKey,
    punchTime: params.punchTime,
    punchType: params.punchType,
    source: params.source,
    remarks: params.remarks,
    createdBy: params.createdBy ?? null
  });

  await recomputeAttendanceForEmployeeDate(params.employeeId, date);

  return created;
}

export async function getAttendanceDay(employeeId: string, inputDate: Date) {
  const date = startOfDay(inputDate);
  const dateKey = toYmd(date);
  const employee = await getAttendanceEmployee(employeeId);

  if (!employee) {
    throw new AttendanceServiceError(404, "Employee not found");
  }

  if (isFutureAttendanceDate(date)) {
    return {
      summary: null,
      punches: [],
      status: "NOT_STARTED" as AttendanceDayUiStatus,
      joiningDate: employee.joiningDate ?? null,
      message: "Attendance is not available for future dates"
    };
  }

  if (isBeforeJoiningDate(date, employee.joiningDate)) {
    return {
      summary: null,
      punches: [],
      status: "NOT_STARTED" as AttendanceDayUiStatus,
      joiningDate: employee.joiningDate ?? null,
      message: `Attendance starts from joining date ${toYmd(employee.joiningDate as Date)}`
    };
  }

  await recomputeAttendanceForEmployeeDate(employeeId, date);

  const policy = getPolicySnapshot(await ensureAttendancePolicy());
  const [summary, punches] = await Promise.all([
    AttendanceDailySummary.findOne({ employeeId, dateKey })
      .populate("holidayId", "name date")
      .populate("leaveId", "fromDate toDate dayUnit status")
      .lean(),
    AttendancePunch.find({ employeeId, dateKey }).sort({ punchTime: 1 }).lean()
  ]);

  const leave = policy.enableLeaveIntegration
    ? await resolveApprovedLeave(employeeId, date)
    : { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null };
  const holiday = policy.enableHolidayIntegration
    ? await resolveHoliday(dateKey, employee?.department ? String(employee.department) : null)
    : null;
  const work = computePunchMetrics(punches);
  const isWeeklyOff = policy.weeklyOffs.includes(
    date.getDay() as (typeof ATTENDANCE_WEEKDAY_VALUES)[number]
  );
  const uiStatus = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work,
    leave,
    holidayId: holiday ? String(holiday._id) : null,
    isWeeklyOff
  });

  return {
    summary,
    punches,
    status: uiStatus.status,
    joiningDate: employee.joiningDate ?? null
  };
}

export function validatePunchSequence(
  punches: Array<Pick<AttendancePunchLike, "punchType" | "punchTime">>,
  nextPunch: Pick<AttendancePunchLike, "punchType" | "punchTime">
) {
  const sortedPunches = [...punches].sort(
    (left, right) => left.punchTime.getTime() - right.punchTime.getTime()
  );
  const latestPunch = sortedPunches[sortedPunches.length - 1];

  if (!latestPunch) {
    if (nextPunch.punchType === "OUT") {
      throw new AttendanceServiceError(409, "Punch out cannot be recorded before punch in");
    }

    return;
  }

  if (nextPunch.punchTime.getTime() < latestPunch.punchTime.getTime()) {
    throw new AttendanceServiceError(409, "Punch time cannot be earlier than the latest recorded punch");
  }

  if (latestPunch.punchType === nextPunch.punchType) {
    throw new AttendanceServiceError(
      409,
      nextPunch.punchType === "IN"
        ? "Punch in cannot be recorded twice in a row"
        : "Punch out cannot be recorded twice in a row"
    );
  }
}

export async function getAttendanceMonth(employeeId: string, month: number, year: number) {
  const employee = await getAttendanceEmployee(employeeId);
  if (!employee) {
    throw new Error("Employee not found");
  }

  const { fromDate, toDate } = getMonthRange(year, month);
  const joiningDate = resolveJoiningDate(employee.joiningDate);
  const effectiveFromDate = joiningDate && joiningDate > fromDate ? joiningDate : fromDate;
  if (effectiveFromDate > toDate) {
    return { items: [], summary: {} };
  }

  const policy = getPolicySnapshot(await ensureAttendancePolicy());
  const [punches, leaves, holidays] = await Promise.all([
    AttendancePunch.find({
      employeeId,
      date: { $gte: effectiveFromDate, $lte: toDate }
    })
      .select("dateKey punchTime punchType")
      .sort({ punchTime: 1 })
      .lean(),
    policy.enableLeaveIntegration
      ? LeaveRequest.find({
          employeeId,
          status: "Approved",
          fromDate: { $lte: endOfDay(toDate) },
          toDate: { $gte: startOfDay(effectiveFromDate) }
        })
          .select("_id fromDate toDate dayUnit")
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve([]),
    policy.enableHolidayIntegration
      ? getApplicableHolidays({
          fromDate,
          toDate,
          departmentId: employee?.department ? String(employee.department) : null
        })
      : Promise.resolve([])
  ]);

  const punchesByDate = new Map<string, AttendancePunchLike[]>();
  punches.forEach((punch) => {
    const datePunches = punchesByDate.get(punch.dateKey) || [];
    datePunches.push({
      punchTime: punch.punchTime,
      punchType: punch.punchType
    });
    punchesByDate.set(punch.dateKey, datePunches);
  });

  const holidayMap = new Map<string, MonthlyHolidayRecord>();
  holidays.forEach((holiday) => {
    holidayMap.set(holiday.dateKey, holiday);
  });

  const operations: any[] = [];

  const current = new Date(effectiveFromDate);
  while (current <= toDate) {
    const date = new Date(current);
    const dateKey = toYmd(date);
    const payload = buildAttendanceSummaryPayload({
      employeeId,
      date,
      policy,
      punches: punchesByDate.get(dateKey) || [],
      leave: policy.enableLeaveIntegration
        ? resolveApprovedLeaveFromRecords(leaves, date)
        : { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
      holiday: policy.enableHolidayIntegration ? holidayMap.get(dateKey) || null : null
    });

    operations.push({
      updateOne: {
        filter: { employeeId, dateKey },
        update: {
          $set: payload
        },
        upsert: true
      }
    });

    current.setDate(current.getDate() + 1);
  }

  if (operations.length > 0) {
    await AttendanceDailySummary.bulkWrite(operations, { ordered: false });
  }

  const items = await AttendanceDailySummary.find({
    employeeId,
    month,
    year,
    date: { $gte: effectiveFromDate, $lte: toDate }
  })
    .sort({ date: 1 })
    .lean();

  const summary = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return { items, summary };
}

export async function listAttendance(params: {
  employeeId?: string;
  employeeIds?: string[];
  departmentId?: string;
  month?: number;
  year?: number;
  status?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  const todayEnd = endOfDay(new Date());

  if (params.employeeId) {
    filter.employeeId = params.employeeId;
  }

  if (params.employeeIds && params.employeeIds.length > 0) {
    filter.employeeId =
      typeof filter.employeeId === "string"
        ? params.employeeIds.includes(filter.employeeId)
          ? filter.employeeId
          : "__no_match__"
        : { $in: params.employeeIds };
  }

  if (params.month) filter.month = params.month;
  if (params.year) filter.year = params.year;
  if (params.status && params.status !== "all") filter.status = params.status;
  if (params.fromDate) {
    filter.date = {
      ...(filter.date as Record<string, unknown> | undefined),
      $gte: startOfDay(new Date(params.fromDate))
    };
  }
  if (params.toDate) {
    const requestedToDate = endOfDay(new Date(params.toDate));
    filter.date = {
      ...(filter.date as Record<string, unknown> | undefined),
      $lte: requestedToDate > todayEnd ? todayEnd : requestedToDate
    };
  }

  if (!params.toDate) {
    if (params.month && params.year) {
      const { toDate } = getMonthRange(params.year, params.month);
      filter.date = { ...(filter.date as Record<string, unknown> | undefined), $lte: toDate };
    } else {
      filter.date = { ...(filter.date as Record<string, unknown> | undefined), $lte: todayEnd };
    }
  }

  if (params.departmentId) {
    const employees = await User.find({
      department: params.departmentId,
      status: "Active",
      isDeleted: false
    })
      .select("_id")
      .lean();

    const employeeIds = employees.map((item) => String(item._id));
    if (typeof filter.employeeId === "string") {
      filter.employeeId = employeeIds.includes(filter.employeeId)
        ? filter.employeeId
        : "__no_match__";
    } else {
      filter.employeeId = { $in: employeeIds };
    }
  }

  const skip = (params.page - 1) * params.limit;
  const [items, total] = await Promise.all([
    AttendanceDailySummary.find(filter)
      .populate({
        path: "employeeId",
        select: "name email department designation joiningDate",
        populate: [
          { path: "department", select: "name" },
          { path: "designation", select: "name" }
        ]
      })
      .populate("holidayId", "name")
      .sort({ date: -1 })
      .skip(skip)
      .limit(params.limit)
      .lean(),
    AttendanceDailySummary.countDocuments(filter)
  ]);

  const filteredItems = items.filter((item) => {
    const employee =
      typeof item.employeeId === "object" && item.employeeId !== null ? item.employeeId : null;
    const joiningDate =
      employee && "joiningDate" in employee ? (employee.joiningDate as Date | string | null | undefined) : null;

    if (!joiningDate) {
      return true;
    }

    return startOfDay(item.date).getTime() >= startOfDay(new Date(joiningDate)).getTime();
  });

  return {
    items: filteredItems,
    total: filteredItems.length < items.length ? filteredItems.length : total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil((filteredItems.length < items.length ? filteredItems.length : total) / params.limit) || 1
  };
}

async function getScopedAttendanceEmployeeIds(params: {
  employeeId?: string;
  employeeIds?: string[];
  departmentId?: string;
}) {
  if (params.employeeId) {
    return [params.employeeId];
  }

  const userFilter: Record<string, unknown> = {
    role: { $in: SELF_ATTENDANCE_ROLES },
    status: "Active",
    isDeleted: false
  };

  if (params.departmentId) {
    userFilter.department = params.departmentId;
  }

  const employees = await User.find(userFilter).select("_id").lean();
  const baseIds = employees.map((item) => String(item._id));

  if (params.employeeIds && params.employeeIds.length > 0) {
    return baseIds.filter((id) => params.employeeIds?.includes(id));
  }

  return baseIds;
}

async function ensureAttendanceDashboardSummaries(params: {
  employeeId?: string;
  employeeIds?: string[];
  departmentId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  if (!params.fromDate || !params.toDate) {
    return;
  }

  const fromDate = startOfDay(new Date(params.fromDate));
  const toDate = startOfDay(new Date(params.toDate));

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return;
  }

  const current = new Date(fromDate);
  const totalDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  if (totalDays <= 0 || totalDays > 7) {
    return;
  }

  const employeeIds = await getScopedAttendanceEmployeeIds(params);

  for (const employeeId of employeeIds) {
    current.setTime(fromDate.getTime());
    while (current <= toDate) {
      await recomputeAttendanceForEmployeeDate(employeeId, current);
      current.setDate(current.getDate() + 1);
    }
  }
}

export async function getAttendanceDashboardSummary(params: {
  employeeId?: string;
  employeeIds?: string[];
  departmentId?: string;
  month?: number;
  year?: number;
  fromDate?: string;
  toDate?: string;
}) {
  await ensureAttendanceDashboardSummaries({
    employeeId: params.employeeId,
    employeeIds: params.employeeIds,
    departmentId: params.departmentId,
    fromDate: params.fromDate,
    toDate: params.toDate
  });

  const list = await listAttendance({
    ...params,
    status: "all",
    page: 1,
    limit: 10000
  });

  const summary = list.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    totalRecords: list.total,
    summary
  };
}

export async function listAttendanceEmployees() {
  return User.find({
    role: { $in: SELF_ATTENDANCE_ROLES },
    isDeleted: false,
    ...buildActiveUserFilter(true)
  })
    .select("_id name email department designation joiningDate")
    .populate("department", "name")
    .populate("designation", "name")
    .sort({ name: 1 })
    .lean();
}

export async function listHolidays(month?: number, year?: number) {
  const filter: Record<string, unknown> = {};

  if (month && year) {
    const { fromDate, toDate } = getMonthRange(year, month);
    filter.date = { $gte: fromDate, $lte: toDate };
  }

  return Holiday.find(filter).populate("departmentId", "name").sort({ date: 1, name: 1 }).lean();
}
