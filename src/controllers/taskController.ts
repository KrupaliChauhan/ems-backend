import type { Request, Response } from "express";
import mongoose from "mongoose";
import Task from "../models/Task";
import {
  createTaskSchema,
  createTaskWorkLogSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  idParamSchema,
  projectIdParamSchema,
  taskWorkLogIdParamSchema,
  formatZodError
} from "../validation/taskValidation";
import { hasAnyRole, PROJECT_MANAGER_ROLES } from "../constants/roles";
import { badRequest, created, forbidden, notFound, ok, serverError } from "../utils/apiResponse";
import { logServerError } from "../utils/serverLogger";
import { getRequestAuthUser } from "../utils/requestContext";
import {
  TASK_MEMBER_STATUS_TRANSITIONS,
  TASK_TEAM_LEADER_STATUS_TRANSITIONS,
  canManageAllProjects,
  ensureEmployeeEligible,
  ensureProjectExists,
  ensureTaskExists,
  hasProjectManagerAccess,
  isProjectLeader,
  isProjectMember
} from "../services/taskService";
import { syncProjectStatusById } from "../services/projectService";
import { notifyTaskAssignment } from "../services/communicationService";
import { recordAuditLog } from "../services/auditService";
import TaskWorkLog from "../models/TaskWorkLog";
import { calculateWorkLogMinutes, getTaskWorkLogSummary, getTaskWorkTotals } from "../services/taskWorkLogService";
import type { TaskAccessRequest } from "../middleware/taskAccessMiddleware";

function canManageProjectTasks(role?: string) {
  return hasAnyRole(role, PROJECT_MANAGER_ROLES);
}

function canUpdateOwnTaskProgress(role?: string) {
  return role === "employee" || role === "teamLeader";
}

function isValidObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function getTaskAccessContext(taskId: string, authUserId: string, authRole?: string) {
  const task = await ensureTaskExists(taskId);
  if (!task) {
    return { task: null, project: null, canAccess: false };
  }

  const project = await ensureProjectExists(String(task.projectId));
  if (!project) {
    return { task, project: null, canAccess: false };
  }

  const canAccess = isProjectLeader(project, authUserId) || String(task.assignedTo) === String(authUserId);

  return { task, project, canAccess };
}

async function getEditableWorkLogContext(params: {
  taskId: string;
  workLogId: string;
  authUserId: string;
  authRole?: string;
}) {
  const access = await getTaskAccessContext(params.taskId, params.authUserId, params.authRole);
  if (!access.task || !access.project || !access.canAccess) {
    return { ...access, workLog: null, canEdit: false };
  }

  const workLog = await TaskWorkLog.findOne({
    _id: params.workLogId,
    taskId: params.taskId
  }).lean();

  if (!workLog) {
    return { ...access, workLog: null, canEdit: false };
  }

  const canEdit =
    (params.authRole === "employee" || params.authRole === "teamLeader") &&
    String(access.task.assignedTo) === String(params.authUserId) &&
    String(workLog.userId) === String(params.authUserId);

  return { ...access, workLog, canEdit };
}

export const createTask = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser || !canManageProjectTasks(authUser.role)) {
      return forbidden(res, "Access denied");
    }

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "Validation failed", formatZodError(parsed.error));
    }

    const project = await ensureProjectExists(parsed.data.projectId);
    if (!project) {
      return notFound(res, "Project not found");
    }

    if (!hasProjectManagerAccess(project, authUser.id, authUser.role)) {
      return forbidden(res, "Access denied");
    }

    const employee = await ensureEmployeeEligible(parsed.data.assignedTo);
    if (!employee) {
      return badRequest(res, "Assigned employee is invalid/inactive/deleted");
    }

    if (!isProjectMember(project, parsed.data.assignedTo)) {
      return badRequest(res, "Assigned employee is not a member of this project");
    }

    const task = await Task.create({
      ...parsed.data,
      description: parsed.data.description ?? "",
      dueDate: parsed.data.dueDate ?? null,
      estimatedHours: parsed.data.estimatedHours ?? null,
      createdBy: authUser.id,
      assignedBy: authUser.id
    });

    await notifyTaskAssignment({
      taskId: String(task._id),
      taskTitle: task.title,
      assignedTo: parsed.data.assignedTo,
      projectId: parsed.data.projectId
    });
    await syncProjectStatusById(parsed.data.projectId);

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.create",
      entityType: "task",
      entityId: String(task._id),
      summary: `Created task ${task.title}`,
      metadata: { projectId: parsed.data.projectId, assignedTo: parsed.data.assignedTo }
    });

    const responseData = {
      success: true,
      message: "Task created successfully",
      taskId: String(task._id)
    };

    return created(res, "Task created successfully", responseData, {
      taskId: String(task._id)
    });
  } catch (error) {
    logServerError("task.create", error);
    return serverError(res, "Failed to create task");
  }
};

export const getTasksByProject = async (req: Request, res: Response) => {
  try {
    const parsedParam = projectIdParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid project id", formatZodError(parsedParam.error));
    }

    const project = await ensureProjectExists(parsedParam.data.projectId);
    if (!project) {
      return notFound(res, "Project not found");
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const hasManagerAccess = canManageAllProjects(authUser.role) || isProjectLeader(project, authUser.id);
    const hasMemberAccess = isProjectMember(project, authUser.id);

    if (!hasManagerAccess && !hasMemberAccess) {
      return forbidden(res, "Access denied");
    }

    const query: Record<string, unknown> = {
      projectId: parsedParam.data.projectId,
      isDeleted: false
    };
    if (!hasManagerAccess) {
      query.assignedTo = authUser.id;
    }

    const tasks = await Task.find(query)
      .select("_id projectId title description assignedTo assignedBy status priority dueDate estimatedHours createdAt updatedAt")
      .populate("assignedTo", "name email")
      .populate("assignedBy", "name email")
      .sort({ createdAt: -1 })
      .lean();
    const workTotals = await getTaskWorkTotals(tasks.map((task) => String(task._id)));

    const [totalTasks, completedTasks] = await Promise.all([
      Task.countDocuments({ projectId: parsedParam.data.projectId, isDeleted: false }),
      Task.countDocuments({ projectId: parsedParam.data.projectId, isDeleted: false, status: "Completed" })
    ]);
    const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

    return ok(res, "Tasks fetched successfully", {
      items: tasks.map((task) => ({
        ...task,
        workLogSummary: workTotals.get(String(task._id)) || {
          totalMinutes: 0,
          totalTimeDisplay: "0h 0m"
        }
      })),
      summary: { totalTasks, completedTasks, progress }
    });
  } catch (error) {
    logServerError("task.listByProject", error);
    return serverError(res, "Failed to fetch tasks");
  }
};

export const getMyTasks = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser || !isValidObjectId(authUser.id)) {
      return forbidden(res, "Invalid token payload");
    }

    const tasks = await Task.find({ assignedTo: authUser.id, isDeleted: false })
      .select("_id projectId title description status priority dueDate estimatedHours createdAt updatedAt")
      .populate("projectId", "name status")
      .sort({ dueDate: 1, createdAt: -1 })
      .lean();
    const workTotals = await getTaskWorkTotals(tasks.map((task) => String(task._id)));

    return ok(res, "My tasks fetched successfully", {
      items: tasks.map((task) => ({
        ...task,
        workLogSummary: workTotals.get(String(task._id)) || {
          totalMinutes: 0,
          totalTimeDisplay: "0h 0m"
        }
      }))
    });
  } catch (error) {
    logServerError("task.myTasks", error);
    return serverError(res, "Failed to fetch my tasks");
  }
};

export const getTaskWorkLogs = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid task id", formatZodError(parsedParam.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const summary = await getTaskWorkLogSummary(parsedParam.data.id);
    return ok(res, "Task work logs fetched successfully", summary);
  } catch (error) {
    logServerError("task.workLogs.list", error);
    return serverError(res, "Failed to fetch task work logs");
  }
};

export const createTaskWorkLog = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid task id", formatZodError(parsedParam.error));
    }

    const parsedBody = createTaskWorkLogSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return badRequest(res, "Validation failed", formatZodError(parsedBody.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const access = (req as TaskAccessRequest).taskAccess;
    if (!access) return forbidden(res, "Access denied");

    const canLogWork = access.isAssignedMember && canUpdateOwnTaskProgress(authUser.role);

    if (!canLogWork) {
      return forbidden(res, "Only the assigned member can add work logs");
    }

    if (access.task.status === "Completed") {
      return forbidden(res, "Completed task work logs cannot be changed");
    }

    const totalMinutes = calculateWorkLogMinutes(parsedBody.data.hours, parsedBody.data.minutes);

    const workLog = await TaskWorkLog.create({
      taskId: parsedParam.data.id,
      userId: authUser.id,
      comment: parsedBody.data.comment,
      hours: parsedBody.data.hours,
      minutes: parsedBody.data.minutes,
      totalMinutes,
      descriptionSnapshot: access.task.description || ""
    });

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.worklog.create",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Logged ${parsedBody.data.hours}h ${parsedBody.data.minutes}m on task ${access.task.title}`,
      metadata: { workLogId: String(workLog._id), totalMinutes }
    });

    const summary = await getTaskWorkLogSummary(parsedParam.data.id);
    return created(
      res,
      "Task work log added successfully",
      {
        id: String(workLog._id),
        ...summary
      },
      summary
    );
  } catch (error) {
    logServerError("task.workLogs.create", error);
    return serverError(res, "Failed to add task work log");
  }
};

export const updateTaskWorkLog = async (req: Request, res: Response) => {
  try {
    const parsedParam = taskWorkLogIdParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid work log request", formatZodError(parsedParam.error));
    }

    const parsedBody = createTaskWorkLogSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return badRequest(res, "Validation failed", formatZodError(parsedBody.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const context = await getEditableWorkLogContext({
      taskId: parsedParam.data.id,
      workLogId: parsedParam.data.workLogId,
      authUserId: authUser.id,
      authRole: authUser.role
    });

    if (!context.task) return notFound(res, "Task not found");
    if (!context.project) return notFound(res, "Project not found");
    if (!context.workLog) return notFound(res, "Work log not found");
    if (!context.canEdit) {
      return forbidden(res, "Only your own assigned work log entries can be updated");
    }
    if (context.task.status === "Completed") {
      return forbidden(res, "Completed task work logs cannot be changed");
    }

    const totalMinutes = calculateWorkLogMinutes(parsedBody.data.hours, parsedBody.data.minutes);

    await TaskWorkLog.findByIdAndUpdate(
      parsedParam.data.workLogId,
      {
        comment: parsedBody.data.comment,
        hours: parsedBody.data.hours,
        minutes: parsedBody.data.minutes,
        totalMinutes
      },
      { runValidators: true }
    );

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.worklog.update",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Updated work log on task ${context.task.title}`,
      metadata: { workLogId: parsedParam.data.workLogId, totalMinutes }
    });

    const summary = await getTaskWorkLogSummary(parsedParam.data.id);
    return ok(res, "Task work log updated successfully", summary, summary);
  } catch (error) {
    logServerError("task.workLogs.update", error);
    return serverError(res, "Failed to update task work log");
  }
};

export const deleteTaskWorkLog = async (req: Request, res: Response) => {
  try {
    const parsedParam = taskWorkLogIdParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid work log request", formatZodError(parsedParam.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const context = await getEditableWorkLogContext({
      taskId: parsedParam.data.id,
      workLogId: parsedParam.data.workLogId,
      authUserId: authUser.id,
      authRole: authUser.role
    });

    if (!context.task) return notFound(res, "Task not found");
    if (!context.project) return notFound(res, "Project not found");
    if (!context.workLog) return notFound(res, "Work log not found");
    if (!context.canEdit) {
      return forbidden(res, "Only your own assigned work log entries can be deleted");
    }
    if (context.task.status === "Completed") {
      return forbidden(res, "Completed task work logs cannot be changed");
    }

    await TaskWorkLog.findByIdAndDelete(parsedParam.data.workLogId);

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.worklog.delete",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Deleted work log on task ${context.task.title}`,
      metadata: { workLogId: parsedParam.data.workLogId }
    });

    const summary = await getTaskWorkLogSummary(parsedParam.data.id);
    return ok(res, "Task work log deleted successfully", summary, summary);
  } catch (error) {
    logServerError("task.workLogs.delete", error);
    return serverError(res, "Failed to delete task work log");
  }
};

export const updateTask = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser || !canManageProjectTasks(authUser.role)) {
      return forbidden(res, "Access denied");
    }

    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid task id", formatZodError(parsedParam.error));
    }

    const parsedBody = updateTaskSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return badRequest(res, "Validation failed", formatZodError(parsedBody.error));
    }

    const task = await Task.findOne({ _id: parsedParam.data.id, isDeleted: false })
      .select("_id projectId assignedTo title")
      .lean();
    if (!task) {
      return notFound(res, "Task not found");
    }

    const project = await ensureProjectExists(String(task.projectId));
    if (!project) {
      return notFound(res, "Project not found");
    }

    if (!hasProjectManagerAccess(project, authUser.id, authUser.role)) {
      return forbidden(res, "Access denied");
    }

    if (parsedBody.data.assignedTo) {
      const employee = await ensureEmployeeEligible(parsedBody.data.assignedTo);
      if (!employee) {
        return badRequest(res, "Assigned employee is invalid/inactive/deleted");
      }

      if (!isProjectMember(project, parsedBody.data.assignedTo)) {
        return badRequest(res, "Assigned employee is not a member of this project");
      }
    }

    const updated = await Task.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        ...parsedBody.data,
      },
      { returnDocument: "after" }
    )
      .select("_id projectId title description assignedTo assignedBy status priority dueDate estimatedHours updatedAt")
      .populate("assignedTo", "name email")
      .populate("assignedBy", "name email")
      .lean();

    if (!updated) {
      return notFound(res, "Task not found");
    }

    await syncProjectStatusById(String(task.projectId));

    if (parsedBody.data.assignedTo && String(task.assignedTo) !== String(parsedBody.data.assignedTo)) {
      await notifyTaskAssignment({
        taskId: parsedParam.data.id,
        taskTitle: updated.title,
        assignedTo: parsedBody.data.assignedTo,
        projectId: String(updated.projectId)
      });
    }

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.update",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Updated task ${updated.title}`,
      metadata: { assignedTo: String(updated.assignedTo?._id ?? task.assignedTo) }
    });

    return ok(res, "Task updated successfully", { task: updated }, { task: updated });
  } catch (error) {
    logServerError("task.update", error);
    return serverError(res, "Failed to update task");
  }
};

export const updateTaskStatus = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid task id", formatZodError(parsedParam.error));
    }

    const parsedBody = updateTaskStatusSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return badRequest(res, "Validation failed", formatZodError(parsedBody.error));
    }

    const authUser = getRequestAuthUser(req);
    if (!authUser) {
      return forbidden(res, "Access denied");
    }

    const access = (req as TaskAccessRequest).taskAccess;
    if (!access) return forbidden(res, "Access denied");

    const task = access.task;
    const allowedTransitions = access.isPrivilegedManager
      ? ["Pending", "In Progress", "In Review", "Completed"].filter((status) => status !== task.status)
      : access.isProjectLeader
        ? TASK_TEAM_LEADER_STATUS_TRANSITIONS[task.status]
      : access.isAssignedMember && canUpdateOwnTaskProgress(authUser.role)
        ? TASK_MEMBER_STATUS_TRANSITIONS[task.status]
        : [];

    if (!allowedTransitions.includes(parsedBody.data.status)) {
      return badRequest(
        res,
        allowedTransitions.length
          ? `Invalid status transition. Allowed: ${task.status} -> ${allowedTransitions.join(", ")}`
          : `Invalid status transition from ${task.status}`
      );
    }

    const updated = await Task.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      { status: parsedBody.data.status },
      { returnDocument: "after" }
    )
      .select("_id projectId title status priority assignedTo dueDate estimatedHours updatedAt")
      .populate("assignedTo", "name email")
      .lean();

    if (!updated) {
      return notFound(res, "Task not found");
    }

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.status.update",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Updated task ${updated.title} status to ${updated.status}`,
      metadata: { status: updated.status }
    });

    return ok(res, "Task status updated successfully", { task: updated }, { task: updated });
  } catch (error) {
    logServerError("task.updateStatus", error);
    return serverError(res, "Failed to update task status");
  }
};

export const softDeleteTask = async (req: Request, res: Response) => {
  try {
    const authUser = getRequestAuthUser(req);
    if (!authUser || !canManageProjectTasks(authUser.role)) {
      return forbidden(res, "Access denied");
    }

    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return badRequest(res, "Invalid task id", formatZodError(parsedParam.error));
    }

    const task = await Task.findOne({ _id: parsedParam.data.id, isDeleted: false })
      .select("_id projectId title")
      .lean();
    if (!task) {
      return notFound(res, "Task not found");
    }

    const project = await ensureProjectExists(String(task.projectId));
    if (!project) {
      return notFound(res, "Project not found");
    }

    if (!hasProjectManagerAccess(project, authUser.id, authUser.role)) {
      return forbidden(res, "Access denied");
    }

    const deleted = await Task.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      { isDeleted: true, deletedAt: new Date(), deletedBy: authUser.id },
      { returnDocument: "after" }
    ).lean();

    if (!deleted) {
      return notFound(res, "Task not found");
    }

    await recordAuditLog({
      actorId: authUser.id,
      actorRole: authUser.role,
      action: "task.delete",
      entityType: "task",
      entityId: parsedParam.data.id,
      summary: `Deleted task ${task.title}`,
      metadata: null
    });

    return ok(res, "Task deleted (soft) successfully", {
      success: true,
      message: "Task deleted (soft) successfully"
    });
  } catch (error) {
    logServerError("task.delete", error);
    return serverError(res, "Failed to delete task");
  }
};
