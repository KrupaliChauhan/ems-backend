import express from "express";
import {
  applyLeave,
  cancelMyLeaveRequest,
  createLeaveHoliday,
  createLeaveType,
  deleteLeaveHoliday,
  deleteLeaveType,
  getActiveLeaveTypes,
  getLeaveBalances,
  getLeaveCalendar,
  getLeaveEmployees,
  getLeaveRequestById,
  getLeaveRequests,
  getLeaveSummary,
  getMyLeaveBalances,
  getMyLeaveRequests,
  listLeaveHolidays,
  listLeaveTypes,
  runLeaveAutomation,
  takeLeaveAction,
  updateLeaveHoliday,
  updateLeaveType
} from "../controllers/leaveController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import {
  LEAVE_HOLIDAY_MANAGER_ROLES,
  LEAVE_REQUEST_VIEW_ROLES,
  LEAVE_TYPE_MANAGER_ROLES
} from "../constants/roles";
import { leaveAttachmentUpload } from "../middleware/uploadLeaveAttachment";

const router = express.Router();

router.get("/types/active", protect, getActiveLeaveTypes);
router.get("/dashboard/summary", protect, getLeaveSummary);
router.get("/calendar", protect, getLeaveCalendar);
router.get("/holidays", protect, listLeaveHolidays);

router.get("/balances/me", protect, getMyLeaveBalances);
router.get("/requests/my", protect, getMyLeaveRequests);
router.post("/requests/apply", protect, leaveAttachmentUpload.single("attachment"), applyLeave);
router.post("/requests/:id/cancel", protect, cancelMyLeaveRequest);
router.get("/requests/:id", protect, getLeaveRequestById);

router.get("/types", protect, requireRoles(...LEAVE_TYPE_MANAGER_ROLES), listLeaveTypes);
router.get("/employees/options", protect, requireRoles(...LEAVE_REQUEST_VIEW_ROLES), getLeaveEmployees);
router.post("/types", protect, requireRoles(...LEAVE_TYPE_MANAGER_ROLES), createLeaveType);
router.put("/types/:id", protect, requireRoles(...LEAVE_TYPE_MANAGER_ROLES), updateLeaveType);
router.delete("/types/:id", protect, requireRoles(...LEAVE_TYPE_MANAGER_ROLES), deleteLeaveType);
router.post("/holidays", protect, requireRoles(...LEAVE_HOLIDAY_MANAGER_ROLES), createLeaveHoliday);
router.put("/holidays/:id", protect, requireRoles(...LEAVE_HOLIDAY_MANAGER_ROLES), updateLeaveHoliday);
router.delete("/holidays/:id", protect, requireRoles(...LEAVE_HOLIDAY_MANAGER_ROLES), deleteLeaveHoliday);

router.get("/balances", protect, requireRoles(...LEAVE_TYPE_MANAGER_ROLES), getLeaveBalances);
router.get("/requests", protect, requireRoles(...LEAVE_REQUEST_VIEW_ROLES), getLeaveRequests);
router.post("/requests/:id/action", protect, requireRoles(...LEAVE_REQUEST_VIEW_ROLES), takeLeaveAction);
router.post("/automation/process", protect, runLeaveAutomation);

export default router;
