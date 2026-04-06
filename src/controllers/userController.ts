import { Request, Response } from "express";
import mongoose from "mongoose";

import User from "../models/User";
import { badRequest, ok, serverError } from "../utils/apiResponse";
import { createUserAccount, listUsers, updateUserAccount, UserServiceError } from "../services/userService";

export const createUser = async (req: Request, res: Response) => {
  try {
    const { name, email, departmentId, designationId, role } = req.body;
    const result = await createUserAccount({
      name,
      email,
      role,
      departmentId,
      designationId
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      id: result.id
    });
  } catch (error) {
    if (error instanceof UserServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
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
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findOne({ _id: id, isDeleted: false })
      .select("_id name email role status department designation")
      .populate("department", "name")
      .populate("designation", "name")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
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
    const users = await User.find({
      role: { $in: ["employee", "teamLeader"] },
      status: "Active",
      isDeleted: false
    })
      .select("_id name email role status")
      .sort({ name: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      data: {
        items: users.map((u: any) => ({
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching employees"
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, departmentId, designationId, role, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const result = await updateUserAccount(String(id), {
      name,
      email,
      role,
      departmentId,
      designationId,
      status:
        status === "Active" || status === "Inactive"
          ? status
          : undefined
    });

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      id: result.id
    });
  } catch (error) {
    if (error instanceof UserServiceError) {
      if (error.statusCode === 404) {
        return res.status(404).json({ message: error.message });
      }

      return badRequest(res, error.message);
    }

    return serverError(res, "Error updating user");
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = String(req.body.status || "");

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updated = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { status },
      { returnDocument: "after" }
    ).select("_id status");

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: updated
    });
  } catch {
    return res.status(500).json({
      message: "Error updating status"
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { returnDocument: "after" }
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });
  } catch {
    return res.status(500).json({
      message: "Error deleting user"
    });
  }
};
