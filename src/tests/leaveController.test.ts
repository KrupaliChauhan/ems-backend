import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveNextLeaveRequestStatus,
  summarizeLeaveStatusBuckets
} from "../controllers/leaveController";

test("resolveNextLeaveRequestStatus keeps intermediate approvals in Level 1 Approved", () => {
  assert.equal(resolveNextLeaveRequestStatus(false), "Level 1 Approved");
  assert.equal(resolveNextLeaveRequestStatus(true), "Approved");
});

test("summarizeLeaveStatusBuckets groups Level 1 Approved into pending counts", () => {
  const result = summarizeLeaveStatusBuckets([
    { _id: "Pending", count: 2 },
    { _id: "Level 1 Approved", count: 3 },
    { _id: "Approved", count: 4 },
    { _id: "Rejected", count: 1 },
    { _id: "Cancelled", count: 5 }
  ], true);

  assert.deepEqual(result, {
    totalRequests: 15,
    pending: 5,
    approved: 4,
    rejected: 1,
    cancelled: 5
  });
});
