import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLeaveDays,
  canCancelLeaveRequest,
  getAllowedLeaveActions,
  getRemainingBalance
} from "../services/leaveService";

test("calculateLeaveDays excludes weekly offs and holidays for full-day leave", () => {
  const holidayKeys = new Set(["2026-03-27"]);
  const weeklyOffs = [0];

  const result = calculateLeaveDays(
    new Date("2026-03-26T10:00:00"),
    new Date("2026-03-29T10:00:00"),
    "FULL",
    holidayKeys,
    weeklyOffs
  );

  assert.equal(result, 2);
});

test("calculateLeaveDays returns half day only for same working date", () => {
  const result = calculateLeaveDays(
    new Date("2026-03-26T10:00:00"),
    new Date("2026-03-26T15:00:00"),
    "HALF",
    new Set(),
    [0]
  );

  assert.equal(result, 0.5);
});

test("getRemainingBalance subtracts used and pending from available balance", () => {
  const result = getRemainingBalance({
    totalAllocated: 24,
    accrued: 2,
    carriedForward: 4,
    used: 1.5,
    pending: 0.5
  });

  assert.equal(result, 28);
});

test("getAllowedLeaveActions and canCancelLeaveRequest respect started vs future leave", () => {
  const futureDate = new Date("2026-03-30T00:00:00");
  const currentDate = new Date("2026-03-26T00:00:00");

  assert.deepEqual(getAllowedLeaveActions("Pending", futureDate, currentDate), ["approve", "reject"]);
  assert.equal(canCancelLeaveRequest("Approved", futureDate, currentDate), true);
  assert.deepEqual(getAllowedLeaveActions("Pending", currentDate, currentDate), ["approve", "reject"]);
  assert.equal(canCancelLeaveRequest("Pending", currentDate, currentDate), false);
});
