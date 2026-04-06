import type { Request, Response } from "express";
import Project from "../models/Project";
import Task from "../models/Task";
import {
  createProjectSchema,
  updateProjectSchema,
  idParamSchema,
  formatZodError
} from "../validation/projectValidation";
import { created, badRequest, forbidden, notFound, ok, serverError } from "../utils/apiResponse";
import { logServerError } from "../utils/serverLogger";
import { getRequestAuthUser } from "../utils/requestContext";
import {
  deriveProjectStatus,
  ensureProjectEmployeesValid,
  findAccessibleProjectById,
  getManagedProjectFilter,
  getNewProjectMembers,
  isEmployeeProjectMember,
  isTeamLeader,
  isValidObjectId,
  isPrivilegedProjectManager,
  normalizeProjectTimeLimitInput,
  syncProjectStatuses,
  uniqueProjectEmployeeIds
} from "../services/projectService";
import { notifyProjectMembersAdded } from "../services/communicationService";
import { recordAuditLog } from "../services/auditService";

export const createProject = async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Validation failed", formatZodError(parsed.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const employees = uniqueProjectEmployeeIds(parsed.data.employees);
    const normalizedTimeLimit = normalizeProjectTimeLimitInput(parsed.data.timeLimit);
    const employeesValid = await ensureProjectEmployeesValid(employees);
    if (!employeesValid) {
      return badRequest(res, "Some selected employees are invalid/inactive/deleted");
    }

    const initialStatus = deriveProjectStatus({
      startDate: parsed.data.startDate,
      timeLimit: normalizedTimeLimit,
      currentStatus: parsed.data.status,
      taskCount: 0
    });

    const project = await Project.create({
      ...parsed.data,
      timeLimit: normalizedTimeLimit,
      status: initialStatus,
      employees,
      createdBy: authUser.id
    });

    await notifyProjectMembersAdded({
      projectId: String(project._id),
      projectName: project.name,
      userIds: employees
    });

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "project.create",
      entityType: "project",
      entityId: String(project._id),
      summary: `Created project ${project.name}`,
      metadata: { employeeCount: employees.length }
    });

    const responseData = {
      message: "Project created successfully",
      projectId: String(project._id)
    };

    return created(res, "Project created successfully", responseData, {
      projectId: String(project._id)
    });
  } catch (error) {
    logServerError("project.create", error);
    return serverError(res, "Failed to create project");
  }
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = getManagedProjectFilter(authUser);
    await syncProjectStatuses();
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }
    if (status !== "all") {
      filter.status = status;
    }

    const [total, projects] = await Promise.all([
      Project.countDocuments(filter),
      Project.find(filter)
        .select("_id name description timeLimit startDate status employees createdAt createdBy")
        .populate("employees", "name email")
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return ok(res, "Projects fetched successfully", {
      items: projects,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    logServerError("project.list", error);
    return serverError(res, "Error fetching projects");
  }
};

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid Id", formatZodError(parsedParam.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    await syncProjectStatuses();

    const project = await findAccessibleProjectById(parsedParam.data.id);
    if (!project) {
      return notFound(res, "Project not found");
    }

    const canManageAllProjects = isPrivilegedProjectManager(authUser.role);
    const isOwnerTeamLeader =
      isTeamLeader(authUser.role) && String(project.createdBy) === String(authUser.id);
    const isMember = isEmployeeProjectMember(project, authUser.id);

    if (!canManageAllProjects && !isOwnerTeamLeader && !isMember) {
      return forbidden(res, "Access denied");
    }

    return ok(res, "Project fetched successfully", project);
  } catch (error) {
    logServerError("project.getById", error);
    return serverError(res, "Failed to fetch project");
  }
};

export const updateProject = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid id", formatZodError(parsedParam.error));
    }

    const parsedBody = updateProjectSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return badRequest(res, "Validation failed", formatZodError(parsedBody.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const employees = uniqueProjectEmployeeIds(parsedBody.data.employees);
    const normalizedTimeLimit = normalizeProjectTimeLimitInput(parsedBody.data.timeLimit);
    const employeesValid = await ensureProjectEmployeesValid(employees);
    if (!employeesValid) {
      return badRequest(res, "Some Selected employees are invalid/inactive/deleted");
    }

    const filter: Record<string, unknown> = { _id: parsedParam.data.id, isDeleted: false };
    if (isTeamLeader(authUser.role) && !isPrivilegedProjectManager(authUser.role)) {
      filter.createdBy = authUser.id;
    }

    const existing = await Project.findOne(filter).select("name employees").lean();
    if (!existing) {
      return notFound(res, "Project not found");
    }
    const taskCount = await Task.countDocuments({ projectId: parsedParam.data.id, isDeleted: false });

    const nextStatus = deriveProjectStatus({
      startDate: parsedBody.data.startDate,
      timeLimit: normalizedTimeLimit,
      currentStatus: parsedBody.data.status,
      taskCount
    });

    const updated = await Project.findOneAndUpdate(
      filter,
      { ...parsedBody.data, timeLimit: normalizedTimeLimit, status: nextStatus, employees },
      { returnDocument: "after" }
    )
      .select("name description timeLimit startDate status employees updatedAt")
      .populate("employees", "name email role")
      .lean();

    if (!updated) {
      return notFound(res, "Project not found");
    }

    const newMembers = getNewProjectMembers(existing.employees || [], employees);
    await notifyProjectMembersAdded({
      projectId: parsedParam.data.id,
      projectName: updated.name,
      userIds: newMembers
    });

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "project.update",
      entityType: "project",
      entityId: parsedParam.data.id,
      summary: `Updated project ${updated.name}`,
      metadata: { newMembersAdded: newMembers.length }
    });

    const responseData = {
      message: "Project updated successfully",
      project: updated
    };

    return ok(res, "Project updated successfully", responseData, {
      project: updated
    });
  } catch (error) {
    logServerError("project.update", error);
    return serverError(res, "Failed to update project");
  }
};

export const softDeleteProject = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid id", formatZodError(parsedParam.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const filter: Record<string, unknown> = { _id: parsedParam.data.id, isDeleted: false };
    if (isTeamLeader(authUser.role) && !isPrivilegedProjectManager(authUser.role)) {
      filter.createdBy = authUser.id;
    }

    const deleted = await Project.findOneAndUpdate(
      filter,
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: authUser.id
      },
      { returnDocument: "after" }
    ).lean();

    if (!deleted) {
      return notFound(res, "Project not found");
    }

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "project.delete",
      entityType: "project",
      entityId: parsedParam.data.id,
      summary: `Deleted project ${deleted.name}`,
      metadata: null
    });

    return ok(res, "Project deleted (soft) successfully", {
      message: "Project deleted (soft) successfully"
    });
  } catch (error) {
    logServerError("project.delete", error);
    return serverError(res, "Failed to delete project");
  }
};

export const getMyProjects = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser || !isValidObjectId(authUser.id)) {
      return forbidden(res, "Invalid token payload");
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "all";

    await syncProjectStatuses();

    const filter: Record<string, unknown> = {
      isDeleted: false,
      employees: authUser.id
    };
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }
    if (status !== "all") {
      filter.status = status;
    }

    const projects = await Project.find(filter)
      .sort({ createdAt: -1 })
      .select("name description timeLimit startDate status employees createdBy")
      .populate("employees", "name email role")
      .populate("createdBy", "name email role")
      .lean();

    return ok(res, "My projects fetched successfully", { items: projects });
  } catch (error) {
    logServerError("project.myProjects", error);
    return serverError(res, "Failed to fetch my projects");
  }
};
