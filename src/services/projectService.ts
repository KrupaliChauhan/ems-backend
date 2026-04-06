import mongoose from "mongoose";
import Project, { type IProject } from "../models/Project";
import Task from "../models/Task";
import User from "../models/User";
import type { AuthUser } from "../utils/requestContext";

export function uniqueProjectEmployeeIds(ids: string[]) {
  return Array.from(new Set(ids.map(String)));
}

export function excludeProjectCreatorFromEmployees(ids: string[], creatorId: string) {
  return ids.filter((id) => String(id) !== String(creatorId));
}

export function isValidObjectId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}

export function isPrivilegedProjectManager(role?: string) {
  return role === "superadmin" || role === "admin";
}

export function isTeamLeader(role?: string) {
  return role === "teamLeader";
}

export function getManagedProjectFilter(authUser: AuthUser) {
  if (isPrivilegedProjectManager(authUser.role)) {
    return { isDeleted: false };
  }

  if (isTeamLeader(authUser.role)) {
    return {
      isDeleted: false,
      $or: [{ createdBy: authUser.id }, { employees: authUser.id }]
    };
  }

  return { isDeleted: false, _id: null };
}

export async function ensureProjectEmployeesValid(employeeIds: string[]) {
  const count = await User.countDocuments({
    _id: { $in: employeeIds },
    role: { $in: ["employee", "teamLeader"] },
    isDeleted: false,
    status: "Active"
  });

  return count === employeeIds.length;
}

export function getNewProjectMembers(
  previousIds: Array<string | mongoose.Types.ObjectId>,
  nextIds: string[]
) {
  const previous = new Set(previousIds.map((item) => String(item)));
  return nextIds.filter((item) => !previous.has(String(item)));
}

export function isEmployeeProjectMember(
  project: Pick<IProject, "employees"> | { employees?: Array<{ _id?: unknown } | string> },
  userId: string
) {
  return (project.employees || []).some(
    (member) => String((member as { _id?: unknown })._id ?? member) === String(userId)
  );
}

export async function findAccessibleProjectById(projectId: string) {
  return Project.findOne({ _id: projectId, isDeleted: false })
    .select("name description timeLimit startDate status employees createdAt updatedAt createdBy")
    .populate("employees", "name email role")
    .populate("createdBy", "name email role")
    .lean();
}

type ParsedProjectTimeLimit = {
  amount: number;
  unit: "day" | "week" | "month" | "year";
};

const PROJECT_TIME_LIMIT_UNIT_ALIASES: Record<string, ParsedProjectTimeLimit["unit"]> = {
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  wk: "week",
  wks: "week",
  week: "week",
  weeks: "week",
  m: "month",
  mo: "month",
  mon: "month",
  mons: "month",
  month: "month",
  months: "month",
  y: "year",
  yr: "year",
  yrs: "year",
  year: "year",
  years: "year"
};

export function parseProjectTimeLimit(timeLimit: string) {
  const normalized = timeLimit.trim().toLowerCase();
  const compactMatch = normalized.match(/^(\d+)\s*([a-z]+)$/);
  const naturalMatch = normalized.match(/^(\d+)\s+([a-z]+)$/);
  const match = compactMatch ?? naturalMatch;
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = PROJECT_TIME_LIMIT_UNIT_ALIASES[match[2]];

  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;

  return { amount, unit };
}

export function normalizeProjectTimeLimitInput(timeLimit: string) {
  const parsed = parseProjectTimeLimit(timeLimit);
  if (!parsed) {
    return timeLimit.trim();
  }

  const suffix = parsed.amount === 1 ? parsed.unit : `${parsed.unit}s`;
  return `${parsed.amount} ${suffix}`;
}

export function resolveProjectEndDate(startDate: Date, timeLimit: string) {
  const parsed = parseProjectTimeLimit(timeLimit);
  if (!parsed) return null;

  const endDate = new Date(startDate);

  if (parsed.unit === "day") {
    endDate.setDate(endDate.getDate() + parsed.amount);
  } else if (parsed.unit === "week") {
    endDate.setDate(endDate.getDate() + parsed.amount * 7);
  } else if (parsed.unit === "month") {
    endDate.setMonth(endDate.getMonth() + parsed.amount);
  } else if (parsed.unit === "year") {
    endDate.setFullYear(endDate.getFullYear() + parsed.amount);
  }

  return endDate;
}

export function deriveProjectStatus(params: {
  startDate: Date;
  timeLimit: string;
  currentStatus: "active" | "pending" | "completed";
  taskCount: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const startDate = new Date(params.startDate);
  startDate.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const endDate = resolveProjectEndDate(params.startDate, params.timeLimit);
  if (endDate) {
    const projectEnd = new Date(endDate);
    projectEnd.setHours(23, 59, 59, 999);
    if (now > projectEnd) {
      return "completed" as const;
    }
  }

  if (params.currentStatus === "active" || params.currentStatus === "completed") {
    return params.currentStatus === "completed" ? "completed" : "active";
  }

  if (params.taskCount > 0 || today >= startDate) {
    return "active" as const;
  }

  return "pending" as const;
}

export async function syncProjectStatusById(projectId: string) {
  const project = await Project.findOne({ _id: projectId, isDeleted: false })
    .select("_id startDate timeLimit status")
    .lean();

  if (!project) return null;

  const taskCount = await Task.countDocuments({ projectId, isDeleted: false });
  const nextStatus = deriveProjectStatus({
    startDate: project.startDate,
    timeLimit: project.timeLimit,
    currentStatus: project.status,
    taskCount
  });

  if (nextStatus !== project.status) {
    await Project.updateOne({ _id: projectId }, { $set: { status: nextStatus } });
  }

  return nextStatus;
}

export async function syncProjectStatuses() {
  const projects = await Project.find({ isDeleted: false })
    .select("_id startDate timeLimit status")
    .lean();

  if (projects.length === 0) return;

  const taskCounts = await Task.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { isDeleted: false } },
    { $group: { _id: "$projectId", count: { $sum: 1 } } }
  ]);

  const taskCountMap = new Map(taskCounts.map((item) => [String(item._id), item.count]));
  const bulkOps = projects
    .map((project) => {
      const nextStatus = deriveProjectStatus({
        startDate: project.startDate,
        timeLimit: project.timeLimit,
        currentStatus: project.status,
        taskCount: taskCountMap.get(String(project._id)) || 0
      });

      if (nextStatus === project.status) return null;

      return {
        updateOne: {
          filter: { _id: project._id },
          update: { $set: { status: nextStatus } }
        }
      };
    })
    .filter(Boolean);

  if (bulkOps.length > 0) {
    for (const operation of bulkOps) {
      if (operation?.updateOne) {
        await Project.updateOne(operation.updateOne.filter, operation.updateOne.update);
      }
    }
  }
}
