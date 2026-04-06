import mongoose from "mongoose";
import TaskWorkLog from "../models/TaskWorkLog";

export function formatWorkLogDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function calculateWorkLogMinutes(hours: number, minutes: number) {
  return hours * 60 + minutes;
}

export function buildTaskWorkLogPayload(log: {
  _id: unknown;
  comment: string;
  hours: number;
  minutes: number;
  totalMinutes: number;
  descriptionSnapshot?: string;
  createdAt?: Date;
  userId?: string | { _id?: unknown; name?: string; email?: string } | null;
  updatedAt?: Date;
}) {
  const user =
    typeof log.userId === "object" && log.userId !== null
      ? log.userId
      : null;

  return {
    id: String(log._id),
    comment: log.comment,
    hours: log.hours,
    minutes: log.minutes,
    totalMinutes: log.totalMinutes,
    timeDisplay: formatWorkLogDuration(log.totalMinutes),
    descriptionSnapshot: log.descriptionSnapshot || "",
    createdAt: log.createdAt ?? null,
    updatedAt: log.updatedAt ?? null,
    user: user
      ? {
          id: String(user._id ?? ""),
          name: String(user.name ?? ""),
          email: String(user.email ?? "")
        }
      : null
  };
}

export async function getTaskWorkLogSummary(taskId: string) {
  const [logs, totalResult] = await Promise.all([
    TaskWorkLog.find({ taskId })
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .lean(),
    TaskWorkLog.aggregate<{ _id: null; totalMinutes: number }>([
      { $match: { taskId: new mongoose.Types.ObjectId(taskId) } },
      { $group: { _id: null, totalMinutes: { $sum: "$totalMinutes" } } }
    ])
  ]);

  const totalMinutes = totalResult[0]?.totalMinutes || 0;

  return {
    items: logs.map(buildTaskWorkLogPayload),
    totalMinutes,
    totalTimeDisplay: formatWorkLogDuration(totalMinutes)
  };
}

export async function getTaskWorkTotals(taskIds: string[]) {
  if (taskIds.length === 0) {
    return new Map<string, { totalMinutes: number; totalTimeDisplay: string }>();
  }

  const results = await TaskWorkLog.aggregate<{
    _id: mongoose.Types.ObjectId;
    totalMinutes: number;
  }>([
    { $match: { taskId: { $in: taskIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: "$taskId", totalMinutes: { $sum: "$totalMinutes" } } }
  ]);

  return new Map(
    results.map((item) => [
      String(item._id),
      {
        totalMinutes: item.totalMinutes,
        totalTimeDisplay: formatWorkLogDuration(item.totalMinutes)
      }
    ])
  );
}
