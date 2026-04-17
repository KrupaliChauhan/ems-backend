import express from "express";
import {
  createAttendancePunch,
  createHoliday,
  deleteHoliday,
  getAttendanceDashboard,
  getAttendanceEmployees,
  getAttendanceList,
  getAttendancePolicy,
  getMyDailyAttendance,
  getMyMonthlyAttendance,
  listAttendanceHolidays,
  recomputeAttendanceByEmployeeDate,
  recomputeAttendanceByRange,
  updateHoliday,
  upsertAttendancePolicy
} from "../controllers/attendanceController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { ATTENDANCE_MANAGER_ROLES, ATTENDANCE_RECOMPUTE_ROLES } from "../constants/roles";

const router = express.Router();

router.get("/policy", protect, getAttendancePolicy);
router.put("/policy", protect, requireRoles(...ATTENDANCE_MANAGER_ROLES), upsertAttendancePolicy);

router.post("/punches", protect, createAttendancePunch);
router.get("/me/daily", protect, getMyDailyAttendance);
router.get("/me/monthly", protect, getMyMonthlyAttendance);

router.get(
  "/employees/options",
  protect,
  getAttendanceEmployees
);
router.get("/records", protect, getAttendanceList);
router.get("/dashboard/summary", protect, getAttendanceDashboard);
router.post(
  "/recompute/range",
  protect,
  requireRoles(...ATTENDANCE_RECOMPUTE_ROLES),
  recomputeAttendanceByRange
);
router.post(
  "/recompute/day",
  protect,
  requireRoles(...ATTENDANCE_RECOMPUTE_ROLES),
  recomputeAttendanceByEmployeeDate
);

router.get("/holidays", protect, listAttendanceHolidays);
router.post("/holidays", protect, requireRoles(...ATTENDANCE_MANAGER_ROLES), createHoliday);
router.put("/holidays/:id", protect, requireRoles(...ATTENDANCE_MANAGER_ROLES), updateHoliday);
router.delete("/holidays/:id", protect, requireRoles(...ATTENDANCE_MANAGER_ROLES), deleteHoliday);

export default router;
