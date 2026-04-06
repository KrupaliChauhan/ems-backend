import { Router } from "express";
import {
  allocateAsset,
  assetHistory,
  createAsset,
  deleteAsset,
  employeeAssets,
  listAssets,
  returnAsset,
  updateAsset
} from "../controllers/assetController";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { MASTER_ACCESS_ROLES } from "../constants/roles";
const router = Router();

router.get("/", protect, requireRoles(...MASTER_ACCESS_ROLES), listAssets);
router.post("/", protect, requireRoles(...MASTER_ACCESS_ROLES), createAsset);
router.put("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), updateAsset);
router.delete("/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), deleteAsset);
router.post("/:id/allocate", protect, requireRoles(...MASTER_ACCESS_ROLES), allocateAsset);
router.post("/:id/return", protect, requireRoles(...MASTER_ACCESS_ROLES), returnAsset);
router.get("/:id/history", protect, requireRoles(...MASTER_ACCESS_ROLES), assetHistory);
router.get("/employee/:id", protect, requireRoles(...MASTER_ACCESS_ROLES), employeeAssets);
export default router;
