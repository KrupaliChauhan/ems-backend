import express from "express";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentById
} from "../controllers/departmentController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { MASTER_ACCESS_ROLES } from "../constants/roles";
import { validateBody } from "../middleware/validate";
import { departmentSchema } from "../validation/departmentValidation";

const router = express.Router();

router.get("/", protect, requireRoles(...MASTER_ACCESS_ROLES), getDepartments);
router.post("/", protect, requireRoles(...MASTER_ACCESS_ROLES), validateBody(departmentSchema), createDepartment);
router.delete("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), deleteDepartment);
router.put("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), validateBody(departmentSchema), updateDepartment);
router.get("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), getDepartmentById);

export default router;
