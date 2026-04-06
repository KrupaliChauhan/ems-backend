import express from "express";
import {
  getAssetReportHandler,
  getAttendanceReportHandler,
  getEmployeeReportHandler,
  getLeaveReportHandler,
  getProjectReportHandler,
  listReportFilters
} from "../controllers/reportController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { MASTER_ACCESS_ROLES } from "../constants/roles";

const router = express.Router();

router.use(protect, requireRoles(...MASTER_ACCESS_ROLES));

router.get("/filters", listReportFilters);
router.get("/attendance", getAttendanceReportHandler);
router.get("/leave", getLeaveReportHandler);
router.get("/assets", getAssetReportHandler);
router.get("/projects", getProjectReportHandler);
router.get("/employees", getEmployeeReportHandler);

export default router;
