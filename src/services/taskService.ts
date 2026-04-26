import Project from "../models/Project";
import Task from "../models/Task";
import User from "../models/User";
import type { TaskStatus } from "../models/Task";
import { buildActiveUserFilter } from "./userService";

export const TASK_MEMBER_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Pending: ["In Progress"],
  "In Progress": ["In Review"],
  "In Review": ["In Progress"],
  Completed: []
};

export const TASK_TEAM_LEADER_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Pending: [],
  "In Progress": [],
  "In Review": ["Completed"],
  Completed: ["In Review"]
};

export function canManageAllProjects(role?: string) {
  return role === "superadmin" || role === "admin" || role === "HR";
}

export async function ensureProjectExists(projectId: string) {
  return Project.findOne({ _id: projectId, isDeleted: false })
    .select("_id name members employees projectLeader createdBy")
    .lean();
}

export async function ensureEmployeeEligible(userId: string) {
  return User.findOne({
    _id: userId,
    role: { $in: ["employee", "teamLeader"] },
    isDeleted: false,
    ...buildActiveUserFilter(true)
  })
    .select("_id teamLeaderId")
    .lean();
}

export async function ensureTaskExists(taskId: string) {
  return Task.findOne({ _id: taskId, isDeleted: false })
    .select("_id projectId createdBy assignedTo status title description")
    .lean();
}

export function getProjectLeaderId(project: { projectLeader?: unknown; createdBy?: unknown }) {
  return String(project.projectLeader ?? project.createdBy ?? "");
}

export function isProjectLeader(project: { projectLeader?: unknown; createdBy?: unknown }, userId: string) {
  return getProjectLeaderId(project) === String(userId);
}

export function hasProjectManagerAccess(
  project: {
    projectLeader?: unknown;
    createdBy?: unknown;
    members?: Array<string | { _id?: unknown }>;
    employees?: Array<string | { _id?: unknown }>;
  },
  userId: string,
  role?: string
) {
  if (canManageAllProjects(role)) {
    return true;
  }

  if (role === "teamLeader") {
    return isProjectLeader(project, userId);
  }

  return false;
}

export function isProjectMember(
  project: { members?: Array<string | { _id?: unknown }>; employees?: Array<string | { _id?: unknown }> },
  userId: string
) {
  return (project.members || project.employees || []).some(
    (id) => String((id as { _id?: unknown })._id ?? id) === String(userId)
  );
}

export async function isManagedByTeamLeader(userId: string, teamLeaderId: string) {
  const employee = await User.findOne({
    _id: userId,
    teamLeaderId,
    role: "employee",
    isDeleted: false
  })
    .select("_id")
    .lean();

  return !!employee;
}
