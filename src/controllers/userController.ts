import { Request, Response } from "express";
import mongoose from "mongoose";

import AssetAllocation from "../models/AssetAllocation";
import User from "../models/User";
import { badRequest, ok, serverError } from "../utils/apiResponse";
import {
  buildActiveUserFilter,
  createUserAccount,
  listUsers,
  normalizeUserStatus,
  updateUserAccount,
  UserServiceError
} from "../services/userService";

export const createUser = async (req: Request, res: Response) => {
  try {
    const { name, email, departmentId, designationId, role, joiningDate, teamLeaderId } = req.body;
    const result = await createUserAccount({
      name,
      email,
      role,
      joiningDate,
      teamLeaderId,
      departmentId,
      designationId
    });

    return res.status(201).json({ success: true, message: "User created successfully", data: { id: result.id } });
  } catch (error) {
    if (error instanceof UserServiceError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }

    console.error(error);

    return serverError(res, "Error creating user");
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();

    const data = await listUsers({ page, limit, search, status });

    return ok(res, "Users fetched successfully", data);
  } catch (error) {
    return serverError(res, "Error fetching users");
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false })
      .select("_id name email role status isActive joiningDate teamLeaderId department designation")
      .populate("teamLeaderId", "name email")
      .populate("department", "name")
      .populate("designation", "name")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: typeof user.isActive === "boolean" ? user.isActive : user.status !== "Inactive",
        status:
          typeof user.isActive === "boolean" ? normalizeUserStatus(user.isActive) : user.status,
        joiningDate: user.joiningDate ?? null,
        teamLeaderId:
          typeof user.teamLeaderId === "object" &&
          user.teamLeaderId !== null &&
          "_id" in user.teamLeaderId
            ? String(user.teamLeaderId._id)
            : user.teamLeaderId
              ? String(user.teamLeaderId)
              : "",
        teamLeaderName:
          typeof user.teamLeaderId === "object" &&
          user.teamLeaderId !== null &&
          "name" in user.teamLeaderId
            ? String(user.teamLeaderId.name ?? "")
            : "",
        departmentId:
          typeof user.department === "object" &&
          user.department !== null &&
          "_id" in user.department
            ? String(user.department._id)
            : user.department
              ? String(user.department)
              : "",
        department:
          typeof user.department === "object" &&
          user.department !== null &&
          "name" in user.department
            ? String(user.department.name ?? "")
            : "",
        designationId:
          typeof user.designation === "object" &&
          user.designation !== null &&
          "_id" in user.designation
            ? String(user.designation._id)
            : user.designation
              ? String(user.designation)
              : "",
        designation:
          typeof user.designation === "object" &&
          user.designation !== null &&
          "name" in user.designation
            ? String(user.designation.name ?? "")
            : ""
      }
    });
  } catch {
    return res.status(500).json({
      message: "Error fetching user"
    });
  }
};

export const getProjectAssignableEmployees = async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {
      role: { $in: ["employee", "teamLeader"] },
      isDeleted: false,
      $and: [buildActiveUserFilter(true)]
    };

    const users = await User.find({
      ...filter
    })
      .select("_id name email role status isActive teamLeaderId")
      .sort({ name: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Project members fetched successfully",
      data: {
        items: users.map((u: any) => ({
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: typeof u.isActive === "boolean" ? u.isActive : u.status !== "Inactive",
          status: typeof u.isActive === "boolean" ? normalizeUserStatus(u.isActive) : u.status
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching project members"
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, departmentId, designationId, role, status, isActive, joiningDate, teamLeaderId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const result = await updateUserAccount(String(id), {
      name,
      email,
      role,
      joiningDate,
      teamLeaderId,
      departmentId,
      designationId,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
      status: status === "Active" || status === "Inactive" ? status : undefined
    });

    return res.status(200).json({ success: true, message: "User updated successfully", data: { id: result.id } });
  } catch (error) {
    if (error instanceof UserServiceError) {
      if (error.statusCode === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }

      return badRequest(res, error.message);
    }

    return serverError(res, "Error updating user");
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requestedIsActive =
      typeof req.body.isActive === "boolean"
        ? req.body.isActive
        : typeof req.body.status === "string"
          ? req.body.status === "Active"
          : undefined;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const existingUser = await User.findOne({ _id: id, isDeleted: false })
      .select("_id name email role status isActive")
      .lean();

    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const nextIsActive =
      typeof requestedIsActive === "boolean"
        ? requestedIsActive
        : !(typeof existingUser.isActive === "boolean" ? existingUser.isActive : existingUser.status !== "Inactive");
    const nextStatus = normalizeUserStatus(nextIsActive);

    const updated = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isActive: nextIsActive, status: nextStatus },
      { returnDocument: "after" }
    ).select("_id name email role status isActive joiningDate teamLeaderId");

    return res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: {
        _id: updated?._id,
        name: updated?.name,
        email: updated?.email,
        role: updated?.role,
        status: updated?.status,
        isActive: updated?.isActive,
        joiningDate: updated?.joiningDate ?? null,
        teamLeaderId: updated?.teamLeaderId ? String(updated.teamLeaderId) : null
      }
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Error updating status"
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const activeAssetAllocation = await AssetAllocation.findOne({
      employeeId: id,
      returnedOn: null
    })
      .select("_id")
      .lean();

    if (activeAssetAllocation) {
      return res.status(400).json({
        success: false,
        message: "User cannot be deleted until all assets are returned"
      });
    }

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { returnDocument: "after" }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Error deleting user"
    });
  }
};
