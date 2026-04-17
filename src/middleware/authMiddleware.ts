import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import { env } from "../config/env";
import { hasAnyRole, type AppRole } from "../constants/roles";
import { normalizeUserStatus } from "../services/userService";

interface JwtPayload {
  id: string;
  role: AppRole;
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;

    const user = await User.findById(decoded.id).select("_id role status isActive isDeleted").lean();

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    if (user.isDeleted) {
      return res.status(403).json({ success: false, message: "Account deleted" });
    }

    const resolvedStatus =
      typeof user.isActive === "boolean" ? normalizeUserStatus(user.isActive) : user.status;

    if (resolvedStatus === "Inactive") {
      return res.status(403).json({ success: false, message: "Account inactive" });
    }

    (req as any).user = { id: String(user._id), role: user.role };

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};
export const requireRoles =
  (...allowedRoles: readonly AppRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).user?.role as AppRole | undefined;
    if (!hasAnyRole(role, allowedRoles)) {
      return res.status(403).json({
        success: false,
        message: "Access denied."
      });
    }
    next();
  };

export const allowSelfOrRoles =
  (...allowedRoles: readonly AppRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id?: string; role?: AppRole } | undefined;
    const targetUserId = typeof req.params?.id === "string" ? req.params.id : "";

    if (user?.id && targetUserId && String(user.id) === String(targetUserId)) {
      return next();
    }

    if (hasAnyRole(user?.role, allowedRoles)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Access denied."
    });
  };

export const superAdminOnly = requireRoles("superadmin");
export const adminOrSuperAdmin = requireRoles("superadmin", "admin");
