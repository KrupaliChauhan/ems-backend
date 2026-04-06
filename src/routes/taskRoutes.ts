import express from "express";
import {
  createTaskWorkLog,
  createTask,
  deleteTaskWorkLog,
  getTaskWorkLogs,
  getTasksByProject,
  getMyTasks,
  updateTaskWorkLog,
  updateTask,
  updateTaskStatus,
  softDeleteTask
} from "../controllers/taskController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { PROJECT_MANAGER_ROLES } from "../constants/roles";

const router = express.Router();

// Employee
router.get("/my", protect, getMyTasks);
router.get("/:id/work-logs", protect, getTaskWorkLogs);
router.post("/:id/work-logs", protect, createTaskWorkLog);
router.put("/:id/work-logs/:workLogId", protect, updateTaskWorkLog);
router.delete("/:id/work-logs/:workLogId", protect, deleteTaskWorkLog);

// Project tasks (role-based filtering inside controller)
router.get("/project/:projectId", protect, getTasksByProject);

// Admin/Superadmin actions (enforced in controller)
router.post("/", protect, requireRoles(...PROJECT_MANAGER_ROLES), createTask);
router.put("/:id", protect, requireRoles(...PROJECT_MANAGER_ROLES), updateTask);
router.put("/:id/status", protect, updateTaskStatus);
router.delete("/:id", protect, requireRoles(...PROJECT_MANAGER_ROLES), softDeleteTask);

export default router;
