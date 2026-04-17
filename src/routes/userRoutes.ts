import express from "express";
import {
  createUser,
  getUsers,
  getUserById,
  getProjectAssignableEmployees,
  updateUser,
  deleteUser,
  updateUserStatus
} from "../controllers/userController";
import { allowSelfOrRoles, protect, requireRoles } from "../middleware/authMiddleware";
import { PROJECT_MANAGER_ROLES, USER_MANAGE_ROLES, USER_VIEW_ROLES } from "../constants/roles";
import { validateBody } from "../middleware/validate";
import { createUserSchema, updateUserSchema, updateUserStatusSchema } from "../validation/userValidation";

const router = express.Router();

router.post("/", protect, requireRoles(...USER_MANAGE_ROLES), validateBody(createUserSchema), createUser);
router.get("/", protect, requireRoles(...USER_VIEW_ROLES), getUsers);
router.get("/project-assignable-employees", protect, requireRoles(...PROJECT_MANAGER_ROLES), getProjectAssignableEmployees);
router.get("/:id", protect, allowSelfOrRoles(...USER_VIEW_ROLES), getUserById);
router.put("/:id", protect, requireRoles(...USER_MANAGE_ROLES), validateBody(updateUserSchema), updateUser);
router.patch(
  "/:id/status",
  protect,
  requireRoles(...USER_MANAGE_ROLES),
  validateBody(updateUserStatusSchema),
  updateUserStatus
);
router.delete("/:id", protect, requireRoles(...USER_MANAGE_ROLES), deleteUser);

export default router;
