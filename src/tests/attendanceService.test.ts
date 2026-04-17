import test from "node:test";
import assert from "node:assert/strict";
import {
  AttendanceServiceError,
  buildDefaultAttendancePolicy,
  computePunchMetrics,
  resolveAttendanceDayUiStatus,
  resolveAttendanceStatus,
  validatePunchSequence
} from "../services/attendanceService";

test("computePunchMetrics calculates worked minutes for valid IN/OUT pairs", () => {
  const result = computePunchMetrics([
    { punchTime: new Date("2026-03-26T09:30:00"), punchType: "IN" },
    { punchTime: new Date("2026-03-26T13:00:00"), punchType: "OUT" },
    { punchTime: new Date("2026-03-26T14:00:00"), punchType: "IN" },
    { punchTime: new Date("2026-03-26T18:30:00"), punchType: "OUT" }
  ]);

  assert.equal(result.totalWorkMinutes, 480);
  assert.equal(result.missedPunch, false);
  assert.equal(result.firstIn?.toISOString(), new Date("2026-03-26T09:30:00").toISOString());
  assert.equal(result.lastOut?.toISOString(), new Date("2026-03-26T18:30:00").toISOString());
});

test("computePunchMetrics marks missed punches when IN has no matching OUT", () => {
  const result = computePunchMetrics([
    { punchTime: new Date("2026-03-26T09:30:00"), punchType: "IN" }
  ]);

  assert.equal(result.totalWorkMinutes, 0);
  assert.equal(result.missedPunch, true);
  assert.ok(result.remarks.includes("Open IN punch without matching OUT"));
});

test("resolveAttendanceStatus returns PRESENT for full day work without issues", () => {
  const policy = buildDefaultAttendancePolicy();
  const work = computePunchMetrics([
    { punchTime: new Date("2026-03-26T09:30:00"), punchType: "IN" },
    { punchTime: new Date("2026-03-26T18:30:00"), punchType: "OUT" }
  ]);

  const result = resolveAttendanceStatus({
    policy,
    punches: [
      { punchTime: new Date("2026-03-26T09:30:00"), punchType: "IN" },
      { punchTime: new Date("2026-03-26T18:30:00"), punchType: "OUT" }
    ],
    work,
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false
  });

  assert.equal(result.status, "PRESENT");
  assert.equal(result.lateMinutes, 0);
});

test("resolveAttendanceStatus returns LEAVE before punch evaluation for approved full leave", () => {
  const policy = buildDefaultAttendancePolicy();
  const work = computePunchMetrics([]);

  const result = resolveAttendanceStatus({
    policy,
    punches: [],
    work,
    leave: { isFullDayLeave: true, isHalfDayLeave: false, leaveId: "leave-1" },
    holidayId: null,
    isWeeklyOff: false
  });

  assert.equal(result.status, "LEAVE");
  assert.equal(result.remarks, "Approved leave applied");
});

test("resolveAttendanceDayUiStatus returns MISSED_PUNCH after shift start before punch in", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches: [],
    work: computePunchMetrics([]),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T10:00:00")
  });

  assert.equal(result.status, "MISSED_PUNCH");
});

test("resolveAttendanceDayUiStatus returns IN_PROGRESS after punch in before punch out", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [{ punchTime: new Date("2026-03-26T09:50:00"), punchType: "IN" as const }];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T10:15:00")
  });

  assert.equal(result.status, "IN_PROGRESS");
});

test("resolveAttendanceDayUiStatus returns MISSED_PUNCH after office end when punch out is missing", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [{ punchTime: new Date("2026-03-26T10:00:00"), punchType: "IN" as const }];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T18:45:00")
  });

  assert.equal(result.status, "MISSED_PUNCH");
});

test("resolveAttendanceDayUiStatus returns LATE only after punch out for a late full day", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [
    { punchTime: new Date("2026-03-26T09:50:00"), punchType: "IN" as const },
    { punchTime: new Date("2026-03-26T18:50:00"), punchType: "OUT" as const }
  ];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T18:55:00")
  });

  assert.equal(result.status, "LATE");
});

test("resolveAttendanceDayUiStatus returns ABSENT when no punch in by half-day cutoff", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches: [],
    work: computePunchMetrics([]),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T14:00:00")
  });

  assert.equal(result.status, "ABSENT");
});

test("resolveAttendanceDayUiStatus returns HALF_DAY after punch out with insufficient hours", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [
    { punchTime: new Date("2026-03-26T09:35:00"), punchType: "IN" as const },
    { punchTime: new Date("2026-03-26T12:00:00"), punchType: "OUT" as const }
  ];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T14:05:00")
  });

  assert.equal(result.status, "HALF_DAY");
});

test("resolveAttendanceDayUiStatus stays neutral before half-day after an early punch out", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [
    { punchTime: new Date("2026-03-26T09:35:00"), punchType: "IN" as const },
    { punchTime: new Date("2026-03-26T11:00:00"), punchType: "OUT" as const }
  ];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T12:15:00")
  });

  assert.equal(result.status, "PRESENT");
});

test("resolveAttendanceDayUiStatus clears half-day messaging when user punches in again", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");
  const punches = [
    { punchTime: new Date("2026-03-26T09:35:00"), punchType: "IN" as const },
    { punchTime: new Date("2026-03-26T12:00:00"), punchType: "OUT" as const },
    { punchTime: new Date("2026-03-26T14:15:00"), punchType: "IN" as const }
  ];

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches,
    work: computePunchMetrics(punches),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T15:00:00")
  });

  assert.equal(result.status, "IN_PROGRESS");
});

test("resolveAttendanceDayUiStatus returns HOLIDAY instead of missed punch messaging on holidays", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches: [],
    work: computePunchMetrics([]),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: "holiday-1",
    isWeeklyOff: false,
    now: new Date("2026-03-26T11:00:00")
  });

  assert.equal(result.status, "HOLIDAY");
});

test("resolveAttendanceDayUiStatus returns LEAVE for approved full-day leave", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-26T00:00:00");

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches: [],
    work: computePunchMetrics([]),
    leave: { isFullDayLeave: true, isHalfDayLeave: false, leaveId: "leave-1" },
    holidayId: null,
    isWeeklyOff: false,
    now: new Date("2026-03-26T11:00:00")
  });

  assert.equal(result.status, "LEAVE");
});

test("resolveAttendanceDayUiStatus returns WEEK_OFF on weekends", () => {
  const policy = buildDefaultAttendancePolicy();
  const date = new Date("2026-03-29T00:00:00");

  const result = resolveAttendanceDayUiStatus({
    date,
    policy,
    punches: [],
    work: computePunchMetrics([]),
    leave: { isFullDayLeave: false, isHalfDayLeave: false, leaveId: null },
    holidayId: null,
    isWeeklyOff: true,
    now: new Date("2026-03-29T11:00:00")
  });

  assert.equal(result.status, "WEEK_OFF");
});

test("validatePunchSequence blocks punch out before any punch in", () => {
  assert.throws(
    () =>
      validatePunchSequence([], {
        punchTime: new Date("2026-03-26T09:30:00"),
        punchType: "OUT"
      }),
    (error) => {
      assert.ok(error instanceof AttendanceServiceError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Punch out cannot be recorded before punch in");
      return true;
    }
  );
});

test("validatePunchSequence blocks duplicate consecutive punch types", () => {
  assert.throws(
    () =>
      validatePunchSequence(
        [{ punchTime: new Date("2026-03-26T09:30:00"), punchType: "IN" }],
        { punchTime: new Date("2026-03-26T09:31:00"), punchType: "IN" }
      ),
    (error) => {
      assert.ok(error instanceof AttendanceServiceError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Punch in cannot be recorded twice in a row");
      return true;
    }
  );
});

test("validatePunchSequence blocks punches older than the latest recorded punch", () => {
  assert.throws(
    () =>
      validatePunchSequence(
        [{ punchTime: new Date("2026-03-26T10:00:00"), punchType: "IN" }],
        { punchTime: new Date("2026-03-26T09:59:00"), punchType: "OUT" }
      ),
    (error) => {
      assert.ok(error instanceof AttendanceServiceError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Punch time cannot be earlier than the latest recorded punch");
      return true;
    }
  );
});
