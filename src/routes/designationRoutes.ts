import express from "express";
import {
  getDesignations,
  createDesignation,
  deleteDesignation,
  getDesignationById,
  updateDesignation
} from "../controllers/designationController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { MASTER_ACCESS_ROLES } from "../constants/roles";
import { validateBody } from "../middleware/validate";
import { designationSchema } from "../validation/designationValidation";

const router = express.Router();

router.get("/", protect, requireRoles(...MASTER_ACCESS_ROLES), getDesignations);
router.post("/", protect, requireRoles(...MASTER_ACCESS_ROLES), validateBody(designationSchema), createDesignation);
router.delete("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), deleteDesignation);
router.get("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), getDesignationById);
router.put("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), validateBody(designationSchema), updateDesignation);

export default router;
