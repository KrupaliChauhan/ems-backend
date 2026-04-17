import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { forbidden, notFound } from "../utils/apiResponse";
import { getRequestAuthUser } from "../utils/requestContext";
import { ensureProjectExists, ensureTaskExists, isProjectLeader } from "../services/taskService";

export type TaskAccessContext = {
  task: NonNullable<Awaited<ReturnType<typeof ensureTaskExists>>>;
  project: NonNullable<Awaited<ReturnType<typeof ensureProjectExists>>>;
  isAssignedMember: boolean;
  isProjectLeader: boolean;
};

export type TaskAccessRequest = Request & {
  taskAccess?: TaskAccessContext;
};

export async function requireTaskAccess(req: Request, res: Response, next: NextFunction) {
  const authUser = getRequestAuthUser(req);
  const taskId = typeof req.params?.id === "string" ? req.params.id : "";

  if (!authUser || !mongoose.Types.ObjectId.isValid(taskId)) {
    return forbidden(res, "Access denied");
  }

  const task = await ensureTaskExists(taskId);
  if (!task) {
    return notFound(res, "Task not found");
  }

  const project = await ensureProjectExists(String(task.projectId));
  if (!project) {
    return notFound(res, "Project not found");
  }

  const isAssignedMember = String(task.assignedTo) === String(authUser.id);
  const hasLeaderAccess = isProjectLeader(project, authUser.id);

  if (!isAssignedMember && !hasLeaderAccess) {
    return forbidden(res, "Access denied");
  }

  (req as TaskAccessRequest).taskAccess = {
    task,
    project,
    isAssignedMember,
    isProjectLeader: hasLeaderAccess
  };

  next();
}
