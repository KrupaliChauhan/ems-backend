import { Request, Response } from "express";
import mongoose from "mongoose";
import Designation from "../models/Designation";
import Department from "../models/Department";
import { badRequest, created, notFound, ok } from "../utils/apiResponse";

export const getDesignations = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = String(req.query.search || "").trim();
    const skip = (page - 1) * limit;
    const departmentId = String(req.query.departmentId || "").trim();

    const filter: Record<string, unknown> = { isDeleted: false };

    if (search) {
      filter.name = { $regex: new RegExp(search, "i") };
    }

    if (departmentId) {
      filter.department = departmentId;
    }

    const total = await Designation.countDocuments(filter);

    const list = await Designation.find(filter)
      .populate("department", "name")
      .select("_id name department status createdAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const items = list.map((designation) => ({
      id: designation._id,
      name: designation.name,
      departmentId: (designation.department as any)?._id ?? null,
      department: (designation.department as any)?.name ?? "",
      status: designation.status
    }));

    return ok(res, "Designations fetched successfully", {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error fetching designations" });
  }
};

export const getDesignationById = async (req: Request, res: Response) => {
  try {
    const designation = await Designation.findOne({ _id: req.params.id, isDeleted: false })
      .populate("department", "name")
      .select("_id name department status")
      .lean();

    if (!designation) return notFound(res, "Designation not found");

    return ok(res, "Designation fetched successfully", {
      id: designation._id,
      name: designation.name,
      departmentId: (designation.department as any)?._id ?? null,
      department: (designation.department as any)?.name ?? "",
      status: designation.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error fetching designation" });
  }
};

export const updateDesignation = async (req: Request, res: Response) => {
  try {
    const { name, departmentId, status } = req.body;
    const id = String(req.params.id);
    const objectId = new mongoose.Types.ObjectId(id);

    const departmentExists = await Department.findById(departmentId);
    if (!departmentExists) {
      return badRequest(res, "Invalid Department");
    }

    const existing = await Designation.findOne({
      _id: { $ne: objectId },
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false
    });

    if (existing) {
      return badRequest(res, "Designation already exists");
    }

    const updated = await Designation.findByIdAndUpdate(
      req.params.id,
      { name, department: departmentId, status },
      { returnDocument: "after" }
    ).populate("department", "name");

    if (!updated) return notFound(res, "Designation not found");

    return ok(res, "Designation updated successfully", {
      id: updated._id,
      name: updated.name,
      departmentId: (updated.department as any)?._id ?? null,
      department: (updated.department as any)?.name ?? "",
      status: updated.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error updating designation" });
  }
};

export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { name, departmentId, status } = req.body;

    const departmentExists = await Department.findOne({
      _id: departmentId,
      isDeleted: false
    });
    if (!departmentExists) {
      return badRequest(res, "Invalid Department");
    }

    const existing = await Designation.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false
    });
    if (existing) {
      return badRequest(res, "Designation already exists");
    }

    const designation = await Designation.create({
      name,
      department: departmentId,
      status
    });

    return created(res, "Designation created successfully", {
      id: designation._id,
      name: designation.name,
      department: departmentExists.name,
      status: designation.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error creating designation" });
  }
};

export const deleteDesignation = async (req: Request, res: Response) => {
  try {
    const deleted = await Designation.findByIdAndUpdate(req.params.id, {
      isDeleted: true
    });

    if (!deleted) return notFound(res, "Designation not found");

    return ok(res, "Designation deleted successfully");
  } catch {
    return res.status(500).json({ success: false, message: "Error deleting designation" });
  }
};
