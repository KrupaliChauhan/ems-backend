import { Request, Response } from "express";
import Department from "../models/Department";
import { badRequest, created, notFound, ok } from "../utils/apiResponse";

export const getDepartments = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = String(req.query.search || "").trim();
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { isDeleted: false };
    if (search) {
      filter.name = { $regex: new RegExp(search, "i") };
    }

    const total = await Department.countDocuments(filter);

    const list = await Department.find(filter)
      .select("_id name status createdAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const items = list.map((department) => ({
      id: department._id,
      name: department.name,
      status: department.status
    }));

    return ok(res, "Departments fetched successfully", {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error fetching departments" });
  }
};

export const getDepartmentById = async (req: Request, res: Response) => {
  try {
    const department = await Department.findOne({ _id: req.params.id, isDeleted: false })
      .select("_id name status")
      .lean();

    if (!department) return notFound(res, "Department not found");

    return ok(res, "Department fetched successfully", {
      id: department._id,
      name: department.name,
      status: department.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error fetching department" });
  }
};

export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name, status } = req.body;

    const existing = await Department.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false
    });

    if (existing) {
      return badRequest(res, "Department already exists");
    }

    const department = await Department.create({ name, status });

    return created(res, "Department created successfully", {
      id: department._id,
      name: department.name,
      status: department.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error creating department" });
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const name = String(req.body.name || "").trim();
    const status = req.body.status;

    if (!name) {
      return badRequest(res, "Department name is required");
    }

    const existing = await Department.findOne({
      _id: { $ne: id },
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isDeleted: false
    });

    if (existing) {
      return badRequest(res, "Department already exists");
    }

    const department = await Department.findByIdAndUpdate(id, { name, status }, { returnDocument: "after" });

    if (!department) {
      return notFound(res, "Department not found");
    }

    return ok(res, "Department updated successfully", {
      id: department._id,
      name: department.name,
      status: department.status
    });
  } catch {
    return res.status(500).json({ success: false, message: "Error updating department" });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const department = await Department.findByIdAndUpdate(id, { isDeleted: true }, { returnDocument: "after" });

    if (!department) {
      return notFound(res, "Department not found");
    }

    return ok(res, "Department deleted successfully");
  } catch {
    return res.status(500).json({ success: false, message: "Error deleting department" });
  }
};
