import Project from "../models/Project";
import Task from "../models/Task";
import User from "../models/User";
import type { TaskStatus } from "../models/Task";

export const TASK_STATUS_FLOW: Record<TaskStatus, TaskStatus | null> = {
  Pending: "In Progress",
  "In Progress": "In Review",
  "In Review": "Completed",
  Completed: null
};

export function canManageAllProjects(role?: string) {
  return role === "superadmin" || role === "admin";
}

export function isTeamLeader(role?: string) {
  return role === "teamLeader";
}

export async function ensureProjectExists(projectId: string) {
  return Project.findOne({ _id: projectId, isDeleted: false })
    .select("_id name employees createdBy")
    .lean();
}

export async function ensureEmployeeEligible(userId: string) {
  return User.findOne({
    _id: userId,
    role: { $in: ["employee", "teamLeader"] },
    isDeleted: false,
    status: "Active"
  })
    .select("_id")
    .lean();
}

export async function ensureTaskExists(taskId: string) {
  return Task.findOne({ _id: taskId, isDeleted: false })
    .select("_id projectId assignedTo title description")
    .lean();
}

export function hasProjectManagerAccess(
  project: { createdBy?: unknown; employees?: Array<string | { _id?: unknown }> },
  userId: string,
  role?: string
) {
  if (canManageAllProjects(role)) {
    return true;
  }

  if (isTeamLeader(role)) {
    return String(project.createdBy) === String(userId);
  }

  return false;
}

export function isProjectMember(
  project: { employees?: Array<string | { _id?: unknown }> },
  userId: string
) {
  return (project.employees || []).some(
    (id) => String((id as { _id?: unknown })._id ?? id) === String(userId)
  );
}
