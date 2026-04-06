import express from "express";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  softDeleteProject,
  getMyProjects
} from "../controllers/projectController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { PROJECT_MANAGER_ROLES } from "../constants/roles";

const router = express.Router();

router.get("/my", protect, getMyProjects);

// Super Admin routes
router.post("/", protect, requireRoles(...PROJECT_MANAGER_ROLES), createProject);
router.get("/", protect, requireRoles(...PROJECT_MANAGER_ROLES), getProjects);
router.get("/:id", protect, getProjectById);
router.put("/:id", protect, requireRoles(...PROJECT_MANAGER_ROLES), updateProject);
router.delete("/:id", protect, requireRoles(...PROJECT_MANAGER_ROLES), softDeleteProject);

export default router;
