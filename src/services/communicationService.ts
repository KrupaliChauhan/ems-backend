import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import type { Types } from "mongoose";
import Announcement, { type AnnouncementDocument } from "../models/Announcement";
import AnnouncementReceipt from "../models/AnnouncementReceipt";
import AppNotification from "../models/AppNotification";
import CommunicationEvent, { type CommunicationEventDocument } from "../models/CommunicationEvent";
import EventInvitation from "../models/EventInvitation";
import Policy, { type PolicyDocument } from "../models/Policy";
import PolicyAcknowledgment from "../models/PolicyAcknowledgment";
import PolicyVersionHistory from "../models/PolicyVersionHistory";
import Task from "../models/Task";
import User from "../models/User";
import Project from "../models/Project";
import type { AppRole } from "../constants/roles";
import { APP_NOTIFICATION_TYPES } from "../models/AppNotification";
import { endOfDay, startOfDay } from "./leaveService";
import { getCommunicationFilePublicUrl } from "../middleware/uploadCommunicationAssets";
import { env, getSmtpConfig } from "../config/env";

export type UploadPayload = {
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
};

export type CommunicationTargeting = {
  allEmployees: boolean;
  departmentIds: string[];
  roleKeys: AppRole[];
  designationIds: string[];
  projectIds: string[];
  userIds: string[];
};

type CommunicationTargetingInput = {
  allEmployees?: boolean;
  departmentIds?: Array<string | Types.ObjectId>;
  roleKeys?: AppRole[];
  designationIds?: Array<string | Types.ObjectId>;
  projectIds?: Array<string | Types.ObjectId>;
  userIds?: Array<string | Types.ObjectId>;
};

type ReminderInput = {
  reminderType: "immediate" | "1_day_before" | "1_hour_before" | "custom";
  channels: Array<"in_app" | "email">;
  customDateTime?: Date | null;
};

type MailUser = {
  _id: Types.ObjectId | string;
  name?: string;
  email: string;
};

const POLICY_RECIPIENT_ROLES: AppRole[] = ["employee", "teamLeader"];

let cachedTransporter:
  | {
      transporter: nodemailer.Transporter;
      fromEmail: string;
    }
  | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const smtp = getSmtpConfig();
  cachedTransporter = {
    fromEmail: smtp.user,
    transporter: nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.password
      }
    })
  };
  return cachedTransporter;
}

function stripDangerousHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/javascript:/gi, "");
}

export function sanitizeRichText(value: string) {
  return stripDangerousHtml(value || "").trim();
}

export function normalizeTargeting(input: CommunicationTargetingInput): CommunicationTargeting {
  const unique = (value: Array<string | Types.ObjectId> | undefined) =>
    Array.from(new Set((value || []).filter(Boolean).map((item) => String(item))));

  return {
    allEmployees: Boolean(input.allEmployees),
    departmentIds: unique(input.departmentIds),
    roleKeys: Array.from(new Set((input.roleKeys || []).filter(Boolean))) as AppRole[],
    designationIds: unique(input.designationIds),
    projectIds: unique(input.projectIds),
    userIds: unique(input.userIds)
  };
}

export function buildUploadPayload(file: Express.Multer.File): UploadPayload {
  return {
    originalName: file.originalname,
    fileName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    url: getCommunicationFilePublicUrl(file.filename)
  };
}

export async function safelyDeleteFiles(paths: string[]) {
  await Promise.allSettled(
    paths.filter(Boolean).map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore cleanup failures
      }
    })
  );
}

async function resolveProjectUserIds(projectIds: string[]) {
  if (projectIds.length === 0) return [];
  const projects = await Project.find({
    _id: { $in: projectIds },
    isDeleted: false
  })
    .select("employees")
    .lean();

  return Array.from(
    new Set(
      projects.flatMap((project) => (project.employees || []).map((employeeId) => String(employeeId)))
    )
  );
}

export async function resolveTargetUserIds(targeting: CommunicationTargeting) {
  if (targeting.allEmployees) {
    const users = await User.find({
      isDeleted: false,
      status: "Active"
    })
      .select("_id")
      .lean();
    return users.map((user) => String(user._id));
  }

  const projectUserIds = await resolveProjectUserIds(targeting.projectIds);
  const userIds = new Set<string>([...targeting.userIds, ...projectUserIds]);

  const filters: Array<Record<string, unknown>> = [];
  if (targeting.departmentIds.length > 0) {
    filters.push({ department: { $in: targeting.departmentIds } });
  }
  if (targeting.roleKeys.length > 0) {
    filters.push({ role: { $in: targeting.roleKeys } });
  }
  if (targeting.designationIds.length > 0) {
    filters.push({ designation: { $in: targeting.designationIds } });
  }
  if (userIds.size > 0) {
    filters.push({ _id: { $in: Array.from(userIds) } });
  }

  if (filters.length === 0) return [];

  const users = await User.find({
    isDeleted: false,
    status: "Active",
    $or: filters
  })
    .select("_id")
    .lean();

  return Array.from(new Set(users.map((user) => String(user._id))));
}

export async function getUserProjectIds(userId: string) {
  const projects = await Project.find({
    isDeleted: false,
    employees: userId
  })
    .select("_id")
    .lean();

  return projects.map((project) => String(project._id));
}

export function buildPolicyCode(title: string, category?: string) {
  const raw = `${title}-${category || ""}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return raw || `policy-${Date.now()}`;
}

export function hasMeaningfulPolicyChange(
  existing: {
    title: string;
    category?: string | null;
    summary?: string | null;
    content: string;
    effectiveDate?: Date | null;
  },
  next: {
    title: string;
    category?: string;
    summary?: string;
    content: string;
    effectiveDate?: Date | null;
  }
) {
  const existingDate = existing.effectiveDate ? new Date(existing.effectiveDate).toISOString() : "";
  const nextDate = next.effectiveDate ? new Date(next.effectiveDate).toISOString() : "";

  return (
    existing.title !== next.title ||
    (existing.category || "") !== (next.category || "") ||
    (existing.summary || "") !== (next.summary || "") ||
    existing.content !== next.content ||
    existingDate !== nextDate
  );
}

export async function createPolicyVersionSnapshot(params: {
  policy: {
    _id: Types.ObjectId | string;
    versionNumber: number;
    title: string;
    category?: string | null;
    summary?: string | null;
    content: string;
    effectiveDate?: Date | null;
    isPublished: boolean;
  };
  changedBy: string;
  changeSummary?: string;
}) {
  await PolicyVersionHistory.create({
    policyId: params.policy._id,
    versionNumber: params.policy.versionNumber,
    title: params.policy.title,
    category: params.policy.category || "",
    summary: params.policy.summary || "",
    content: params.policy.content,
    effectiveDate: params.policy.effectiveDate ?? null,
    isPublished: params.policy.isPublished,
    changeSummary: params.changeSummary || "",
    changedBy: params.changedBy,
    changedAt: new Date()
  });
}

export async function getPolicyRecipientUsers(filters?: {
  departmentId?: string;
  employeeId?: string;
}) {
  return User.find({
    isDeleted: false,
    status: "Active",
    role: { $in: POLICY_RECIPIENT_ROLES },
    ...(filters?.departmentId ? { department: filters.departmentId } : {}),
    ...(filters?.employeeId ? { _id: filters.employeeId } : {})
  })
    .select("_id name email role department")
    .populate("department", "name")
    .sort({ name: 1 })
    .lean();
}

async function getPolicyRecipientIds(filters?: {
  departmentId?: string;
  employeeId?: string;
}) {
  const users = await getPolicyRecipientUsers(filters);
  return users.map((user) => String(user._id));
}

export async function computePolicyAcknowledgmentSummary(policyId: string, versionNumber: number) {
  const [employees, acknowledgments] = await Promise.all([
    getPolicyRecipientUsers(),
    PolicyAcknowledgment.find({
      policyId,
      versionNumber
    })
      .select("employeeId acknowledgedAt")
      .lean()
  ]);

  const acknowledgedIds = new Set(acknowledgments.map((item) => String(item.employeeId)));

  return {
    totalEmployees: employees.length,
    acknowledgedCount: acknowledgments.length,
    pendingCount: employees.length - acknowledgments.length,
    acknowledgedIds: Array.from(acknowledgedIds)
  };
}

export async function computePolicyAcknowledgmentReport(params: {
  policyId: string;
  versionNumber: number;
  departmentId?: string;
  employeeId?: string;
  status?: "all" | "ACKNOWLEDGED" | "PENDING";
}) {
  const employees = await getPolicyRecipientUsers({
    departmentId: params.departmentId,
    employeeId: params.employeeId
  });

  const acknowledgments = await PolicyAcknowledgment.find({
    policyId: params.policyId,
    versionNumber: params.versionNumber,
    ...(params.employeeId ? { employeeId: params.employeeId } : {})
  })
    .select("employeeId acknowledgedAt status")
    .lean();

  const acknowledgmentMap = new Map(
    acknowledgments.map((item) => [String(item.employeeId), item])
  );

  const items = employees
    .map((employee) => {
      const acknowledgment = acknowledgmentMap.get(String(employee._id));
      return {
        employeeId: String(employee._id),
        employeeName: employee.name,
        email: employee.email,
        departmentId:
          typeof employee.department === "object" && employee.department !== null && "_id" in employee.department
            ? String(employee.department._id)
            : employee.department
              ? String(employee.department)
              : null,
        departmentName:
          typeof employee.department === "object" && employee.department !== null && "name" in employee.department
            ? String(employee.department.name || "")
            : "",
        versionNumber: params.versionNumber,
        status: acknowledgment ? "ACKNOWLEDGED" : "PENDING",
        acknowledgedAt: acknowledgment?.acknowledgedAt ?? null
      };
    })
    .filter((item) => params.status === "all" || item.status === params.status);

  const acknowledgedCount = items.filter((item) => item.status === "ACKNOWLEDGED").length;

  return {
    totalEmployees: items.length,
    acknowledgedCount,
    pendingCount: items.length - acknowledgedCount,
    items
  };
}

export async function notifyPolicyUsers(params: {
  policy:
    | PolicyDocument
    | {
        _id: Types.ObjectId | string;
        title: string;
        summary?: string;
        versionNumber: number;
        isPublished: boolean;
      };
  reason: "published" | "updated";
}) {
  if (!params.policy.isPublished) return;

  const users = await getPolicyRecipientUsers();
  if (users.length === 0) return;

  await sendEmailBatch({
    users: users.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email
    })),
    subject:
      params.reason === "published"
        ? `New Policy Published: ${params.policy.title}`
        : `Policy Updated: ${params.policy.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hello {{name}},</p>
        <p>${
          params.reason === "published"
            ? "A company policy has been published in EMS."
            : "A company policy has been updated in EMS."
        }</p>
        <h2>${params.policy.title}</h2>
        <p>${params.policy.summary || "Please review and acknowledge the latest policy version."}</p>
        <p><strong>Current version:</strong> ${params.policy.versionNumber}</p>
        <p>
          <a href="${env.frontendUrl}/communications/policies/${params.policy._id}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;">
            View Policy
          </a>
        </p>
      </div>
    `
  });
}

export async function isUserTargeted(params: {
  userId: string;
  role: AppRole;
  departmentId?: string | null;
  designationId?: string | null;
  projectIds?: string[];
  targeting: CommunicationTargeting;
}) {
  const { userId, role, departmentId, designationId, projectIds = [], targeting } = params;
  if (targeting.allEmployees) return true;
  if (targeting.userIds.includes(userId)) return true;
  if (targeting.roleKeys.includes(role)) return true;
  if (departmentId && targeting.departmentIds.includes(departmentId)) return true;
  if (designationId && targeting.designationIds.includes(designationId)) return true;
  if (projectIds.some((projectId) => targeting.projectIds.includes(projectId))) return true;
  return false;
}

function buildEventReminderDueAt(
  eventDoc: {
    startDate: Date;
    startTime?: string;
    allDay: boolean;
  },
  reminder: ReminderInput
) {
  const startAt = new Date(eventDoc.startDate);
  if (!eventDoc.allDay && reminder.reminderType !== "custom" && eventDoc.startTime) {
    const [hours, minutes] = eventDoc.startTime.split(":").map(Number);
    startAt.setHours(hours || 0, minutes || 0, 0, 0);
  } else {
    startAt.setHours(9, 0, 0, 0);
  }

  switch (reminder.reminderType) {
    case "immediate":
      return new Date(startAt);
    case "1_day_before":
      return new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
    case "1_hour_before":
      return new Date(startAt.getTime() - 60 * 60 * 1000);
    case "custom":
      return reminder.customDateTime ? new Date(reminder.customDateTime) : new Date(startAt);
    default:
      return new Date(startAt);
  }
}

async function sendEmailBatch(params: {
  users: MailUser[];
  subject: string;
  html: string;
}) {
  if (params.users.length === 0) return;

  try {
    const { fromEmail, transporter } = getTransporter();
    await Promise.allSettled(
      params.users.map((user) =>
        transporter.sendMail({
          from: `"EMS System" <${fromEmail}>`,
          to: user.email,
          subject: params.subject,
          html: params.html.replace(/\{\{name\}\}/g, user.name || user.email)
        })
      )
    );
  } catch {
    // email failures should not block core flow
  }
}

export async function upsertAppNotifications(payloads: Array<{
  userId: string;
  title: string;
  message: string;
  type: (typeof APP_NOTIFICATION_TYPES)[number];
  link: string;
  entityType: "announcement" | "event" | "leave_request" | "task" | "project" | "policy";
  entityId: string;
  dedupeKey: string;
}>) {
  if (payloads.length === 0) return;

  await Promise.all(
    payloads.map((payload) =>
      AppNotification.findOneAndUpdate(
        { dedupeKey: payload.dedupeKey },
        payload,
        { upsert: true, setDefaultsOnInsert: true, returnDocument: "after" }
      )
    )
  );
}

export async function notifyTaskAssignment(params: {
  taskId: string;
  taskTitle: string;
  assignedTo: string;
  projectId: string;
}) {
  await upsertAppNotifications([
    {
      userId: params.assignedTo,
      title: "New Task Assigned",
      message: `${params.taskTitle} has been assigned to you.`,
      type: "task_assignment",
      link: "/my-tasks",
      entityType: "task",
      entityId: params.taskId,
      dedupeKey: `task:${params.taskId}:assigned:${params.assignedTo}`
    }
  ]);
}

export async function notifyProjectMembersAdded(params: {
  projectId: string;
  projectName: string;
  userIds: string[];
}) {
  if (params.userIds.length === 0) return;

  await upsertAppNotifications(
    params.userIds.map((userId) => ({
      userId,
      title: "Added To Project",
      message: `You have been added to ${params.projectName}.`,
      type: "project_member_added" as const,
      link: "/projects",
      entityType: "project",
      entityId: params.projectId,
      dedupeKey: `project:${params.projectId}:member:${userId}`
    }))
  );
}

export function getReplacedUploadPaths(params: {
  existingAttachments: Array<{ path: string }>;
  existingBannerPath?: string | null;
  attachmentsReplaced: boolean;
  bannerReplaced: boolean;
}) {
  return [
    ...(params.attachmentsReplaced ? params.existingAttachments.map((item) => item.path) : []),
    ...(params.bannerReplaced && params.existingBannerPath ? [params.existingBannerPath] : [])
  ];
}

export async function syncAnnouncementDistribution(
  announcementDoc:
    | AnnouncementDocument
    | {
        _id: Types.ObjectId | string;
        title: string;
        summary: string;
        publishDate: Date;
        sendEmail: boolean;
        sendInAppNotification: boolean;
        targeting: CommunicationTargeting;
      }
) {
  const targetUserIds = await resolveTargetUserIds(normalizeTargeting(announcementDoc.targeting));
  if (targetUserIds.length === 0) return { totalRecipients: 0 };

  const existingReceipts = await AnnouncementReceipt.find({
    announcementId: announcementDoc._id,
    userId: { $in: targetUserIds }
  })
    .select("userId")
    .lean();

  const existingSet = new Set(existingReceipts.map((item) => String(item.userId)));
  const newUserIds = targetUserIds.filter((userId) => !existingSet.has(userId));

  if (newUserIds.length > 0) {
    await AnnouncementReceipt.insertMany(
      newUserIds.map((userId) => ({
        announcementId: announcementDoc._id,
        userId,
        deliveredAt: new Date()
      }))
    );
  }

  if (announcementDoc.sendInAppNotification) {
    await upsertAppNotifications(
      targetUserIds.map((userId) => ({
        userId,
        title: announcementDoc.title,
        message: announcementDoc.summary,
        type: "announcement",
        link: `/communications/announcements/${announcementDoc._id}`,
        entityType: "announcement",
        entityId: String(announcementDoc._id),
        dedupeKey: `announcement:${announcementDoc._id}:user:${userId}`
      }))
    );
  }

  if (announcementDoc.sendEmail && newUserIds.length > 0) {
    const users = await User.find({ _id: { $in: newUserIds } })
      .select("_id name email")
      .lean();

    await sendEmailBatch({
      users: users.map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email
      })),
      subject: `Announcement: ${announcementDoc.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>Hello {{name}},</p>
          <p>A new announcement has been published in EMS.</p>
          <h2>${announcementDoc.title}</h2>
          <p>${announcementDoc.summary}</p>
          <p>
            <a href="${env.frontendUrl}/communications/announcements/${announcementDoc._id}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;">
              View Announcement
            </a>
          </p>
        </div>
      `
    });
  }

  await Announcement.findByIdAndUpdate(announcementDoc._id, {
    distributionProcessedAt: new Date()
  });

  return { totalRecipients: targetUserIds.length };
}

export async function syncEventDistribution(
  eventDoc:
    | CommunicationEventDocument
    | {
        _id: Types.ObjectId | string;
        title: string;
        description: string;
        sendEmail: boolean;
        sendInAppNotification: boolean;
        targeting: CommunicationTargeting;
      }
) {
  const targetUserIds = await resolveTargetUserIds(normalizeTargeting(eventDoc.targeting));
  if (targetUserIds.length === 0) return { totalRecipients: 0 };

  const existingInvitations = await EventInvitation.find({
    eventId: eventDoc._id,
    userId: { $in: targetUserIds }
  })
    .select("userId")
    .lean();

  const existingSet = new Set(existingInvitations.map((item) => String(item.userId)));
  const newUserIds = targetUserIds.filter((userId) => !existingSet.has(userId));

  if (newUserIds.length > 0) {
    await EventInvitation.insertMany(
      newUserIds.map((userId) => ({
        eventId: eventDoc._id,
        userId,
        status: "Pending"
      }))
    );
  }

  if (eventDoc.sendInAppNotification) {
    await upsertAppNotifications(
      targetUserIds.map((userId) => ({
        userId,
        title: eventDoc.title,
        message: eventDoc.description.slice(0, 180),
        type: "event",
        link: `/communications/events/${eventDoc._id}`,
        entityType: "event",
        entityId: String(eventDoc._id),
        dedupeKey: `event:${eventDoc._id}:user:${userId}:invite`
      }))
    );
  }

  if (eventDoc.sendEmail && newUserIds.length > 0) {
    const users = await User.find({ _id: { $in: newUserIds } })
      .select("_id name email")
      .lean();

    await sendEmailBatch({
      users: users.map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email
      })),
      subject: `Event Invitation: ${eventDoc.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <p>Hello {{name}},</p>
          <p>You have been invited to an event in EMS.</p>
          <h2>${eventDoc.title}</h2>
          <p>${eventDoc.description.slice(0, 250)}</p>
          <p>
            <a href="${env.frontendUrl}/communications/events/${eventDoc._id}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;">
              View Event
            </a>
          </p>
        </div>
      `
    });
  }

  await CommunicationEvent.findByIdAndUpdate(eventDoc._id, {
    distributionProcessedAt: new Date()
  });

  return { totalRecipients: targetUserIds.length };
}

export async function processCommunicationAutomation() {
  const now = new Date();

  const dueDraftAnnouncements = await Announcement.find({
    status: "draft",
    publishDate: { $lte: now },
    isDeleted: false
  });

  for (const announcement of dueDraftAnnouncements) {
    announcement.status = "published";
    announcement.publishedAt = announcement.publishedAt ?? new Date(now);
    announcement.distributionProcessedAt = null;
    await announcement.save();
    await syncAnnouncementDistribution(announcement);
  }

  await Announcement.updateMany(
    {
      status: "published",
      expiryDate: { $ne: null, $lt: now },
      isDeleted: false
    },
    {
      status: "expired"
    }
  );

  await CommunicationEvent.updateMany(
    {
      status: "published",
      endDate: { $lt: startOfDay(now) },
      isDeleted: false
    },
    {
      status: "completed"
    }
  );

  const dueAnnouncements = await Announcement.find({
    status: "published",
    publishDate: { $lte: now },
    distributionProcessedAt: null,
    isDeleted: false
  });

  for (const announcement of dueAnnouncements) {
    await syncAnnouncementDistribution(announcement);
  }

  const dueEvents = await CommunicationEvent.find({
    status: "published",
    publishDate: { $lte: now },
    distributionProcessedAt: null,
    isDeleted: false
  });

  for (const eventDoc of dueEvents) {
    await syncEventDistribution(eventDoc);
  }

  const reminderCandidates = await CommunicationEvent.find({
    status: "published",
    isDeleted: false,
    publishDate: { $lte: now },
    startDate: { $gte: startOfDay(new Date(now.getTime() - 24 * 60 * 60 * 1000)) },
    reminderSettings: { $elemMatch: { processedAt: null } }
  });

  for (const eventDoc of reminderCandidates) {
    const targetUserIds = await resolveTargetUserIds(
      normalizeTargeting(eventDoc.targeting)
    );
    if (targetUserIds.length === 0) continue;

    const users =
      targetUserIds.length > 0
        ? await User.find({ _id: { $in: targetUserIds } }).select("_id name email").lean()
        : [];

    let updated = false;
    for (const reminder of eventDoc.reminderSettings) {
      if (reminder.processedAt) continue;
      const dueAt = buildEventReminderDueAt(
        {
          startDate: eventDoc.startDate,
          startTime: eventDoc.startTime,
          allDay: eventDoc.allDay
        },
        {
          reminderType: reminder.reminderType,
          channels: (reminder.channels || []) as Array<"in_app" | "email">,
          customDateTime: reminder.customDateTime
        }
      );

      if (dueAt > now) continue;

      if ((reminder.channels || []).includes("in_app")) {
        await upsertAppNotifications(
          targetUserIds.map((userId) => ({
            userId,
            title: `Reminder: ${eventDoc.title}`,
            message: "Event reminder from EMS",
            type: "event_reminder",
            link: `/communications/events/${eventDoc._id}`,
            entityType: "event",
            entityId: String(eventDoc._id),
            dedupeKey: `event:${eventDoc._id}:user:${userId}:reminder:${String(reminder._id)}`
          }))
        );
      }

      if ((reminder.channels || []).includes("email")) {
        await sendEmailBatch({
          users: users.map((user) => ({
            _id: user._id,
            name: user.name,
            email: user.email
          })),
          subject: `Reminder: ${eventDoc.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
              <p>Hello {{name}},</p>
              <p>This is a reminder for the upcoming event:</p>
              <h2>${eventDoc.title}</h2>
              <p>
                <a href="${env.frontendUrl}/communications/events/${eventDoc._id}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;">
                  View Event
                </a>
              </p>
            </div>
          `
        });
      }

      reminder.processedAt = new Date();
      updated = true;
    }

    if (updated) {
      await eventDoc.save();
    }
  }

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const taskDueToday = await Task.find({
    isDeleted: false,
    status: { $ne: "Completed" },
    dueDate: { $gte: todayStart, $lte: todayEnd }
  })
    .select("_id title assignedTo")
    .lean();

  if (taskDueToday.length > 0) {
    await upsertAppNotifications(
      taskDueToday.map((task) => ({
        userId: String(task.assignedTo),
        title: "Task Due Today",
        message: `${task.title} is due today.`,
        type: "task_due" as const,
        link: "/my-tasks",
        entityType: "task",
        entityId: String(task._id),
        dedupeKey: `task:${task._id}:due:${todayStart.toISOString().slice(0, 10)}`
      }))
    );
  }

  const taskOverdue = await Task.find({
    isDeleted: false,
    status: { $ne: "Completed" },
    dueDate: { $lt: todayStart }
  })
    .select("_id title assignedTo dueDate")
    .lean();

  if (taskOverdue.length > 0) {
    await upsertAppNotifications(
      taskOverdue.map((task) => ({
        userId: String(task.assignedTo),
        title: "Task Overdue",
        message: `${task.title} is overdue and needs attention.`,
        type: "task_overdue" as const,
        link: "/my-tasks",
        entityType: "task",
        entityId: String(task._id),
        dedupeKey: `task:${task._id}:overdue:${todayStart.toISOString().slice(0, 10)}`
      }))
    );
  }

  const publishedPolicies = await Policy.find({
    isDeleted: false,
    isPublished: true
  })
    .select("_id title")
    .lean();

  for (const policy of publishedPolicies) {
    const recipientIds = await getPolicyRecipientIds();
    if (recipientIds.length === 0) continue;

    const acknowledged = await PolicyAcknowledgment.find({
      policyId: policy._id,
      employeeId: { $in: recipientIds }
    })
      .select("employeeId")
      .lean();

    const acknowledgedIds = new Set(acknowledged.map((item) => String(item.employeeId)));
    const pendingUserIds = recipientIds.filter((userId) => !acknowledgedIds.has(String(userId)));

    if (pendingUserIds.length === 0) continue;

    await upsertAppNotifications(
      pendingUserIds.map((userId) => ({
        userId,
        title: "Policy Acknowledgment Pending",
        message: `${policy.title} is still pending your acknowledgment.`,
        type: "policy_acknowledgment_reminder" as const,
        link: `/communications/policies/${policy._id}`,
        entityType: "policy",
        entityId: String(policy._id),
        dedupeKey: `policy:${policy._id}:pending:${userId}:${todayStart.toISOString().slice(0, 10)}`
      }))
    );
  }
}

export async function computeAnnouncementReport(
  announcementId: string,
  targeting: CommunicationTargeting
) {
  const targetUserIds = await resolveTargetUserIds(normalizeTargeting(targeting));
  const receipts = await AnnouncementReceipt.find({
    announcementId,
    userId: { $in: targetUserIds }
  })
    .select("userId openedAt acknowledgedAt deliveredAt")
    .populate("userId", "name email")
    .lean();

  const read = receipts.filter((item) => item.openedAt).length;
  const acknowledged = receipts.filter((item) => item.acknowledgedAt).length;
  const targetedSet = new Set(targetUserIds);
  const readUsers = receipts.filter((item) => item.openedAt).map((item) => item.userId);
  const acknowledgedUsers = receipts
    .filter((item) => item.acknowledgedAt)
    .map((item) => item.userId);
  const openedUserIds = new Set(
    receipts
      .filter((item) => item.openedAt)
      .map((item) => String((item.userId as { _id?: Types.ObjectId | string })._id ?? item.userId))
  );

  return {
    totalTargetedUsers: targetUserIds.length,
    totalRead: read,
    totalUnread: targetUserIds.length - read,
    totalAcknowledged: acknowledged,
    readUsers,
    acknowledgedUsers,
    unreadUserIds: Array.from(targetedSet).filter((userId) => !openedUserIds.has(userId))
  };
}

export async function computeEventReport(eventId: string, targeting: CommunicationTargeting) {
  const targetUserIds = await resolveTargetUserIds(normalizeTargeting(targeting));
  const invitations = await EventInvitation.find({
    eventId,
    userId: { $in: targetUserIds }
  })
    .populate("userId", "name email")
    .lean();

  const counts = invitations.reduce(
    (acc, invitation) => {
      acc[invitation.status] = (acc[invitation.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalInvitedUsers = targetUserIds.length;
  const accepted = counts.Accepted || 0;
  const declined = counts.Declined || 0;
  const maybe = counts.Maybe || 0;
  const pending = Math.max(0, totalInvitedUsers - accepted - declined - maybe);

  return {
    totalInvitedUsers,
    acceptedUsers: invitations.filter((item) => item.status === "Accepted").map((item) => item.userId),
    declinedUsers: invitations.filter((item) => item.status === "Declined").map((item) => item.userId),
    maybeUsers: invitations.filter((item) => item.status === "Maybe").map((item) => item.userId),
    pendingUsers: invitations.filter((item) => item.status === "Pending").map((item) => item.userId),
    counts: {
      accepted,
      declined,
      maybe,
      pending
    }
  };
}

export function buildDateTimeValue(date: Date, hhmmValue?: string) {
  const resolved = new Date(date);
  if (hhmmValue) {
    const [hours, minutes] = hhmmValue.split(":").map(Number);
    resolved.setHours(hours || 0, minutes || 0, 0, 0);
  } else {
    resolved.setHours(0, 0, 0, 0);
  }
  return resolved;
}

export function isAnnouncementCurrentlyVisible(doc: {
  status: string;
  publishDate: Date;
  expiryDate?: Date | null;
  isDeleted?: boolean;
}) {
  const now = new Date();
  if (doc.isDeleted) return false;
  if (doc.status !== "published") return false;
  if (new Date(doc.publishDate) > now) return false;
  if (doc.expiryDate && new Date(doc.expiryDate) < now) return false;
  return true;
}

export function isEventCurrentlyVisible(doc: {
  status: string;
  publishDate: Date;
  isDeleted?: boolean;
}) {
  if (doc.isDeleted) return false;
  if (doc.status !== "published" && doc.status !== "completed") return false;
  return new Date(doc.publishDate) <= new Date();
}

export function getAnnouncementLifecycleLabel(doc: {
  status: string;
  publishDate: Date;
  expiryDate?: Date | null;
}) {
  const now = new Date();
  if (doc.status === "archived") return "archived";
  if (doc.status === "expired") return "expired";
  if (doc.status === "draft") return "draft";
  if (new Date(doc.publishDate) > now) return "scheduled";
  if (doc.expiryDate && new Date(doc.expiryDate) < now) return "expired";
  return "published";
}

export function getEventLifecycleLabel(doc: {
  status: string;
  publishDate: Date;
  startDate: Date;
  endDate: Date;
}) {
  const now = new Date();
  if (doc.status === "archived") return "archived";
  if (doc.status === "cancelled") return "cancelled";
  if (doc.status === "draft") return "draft";
  if (new Date(doc.publishDate) > now) return "scheduled";
  if (endOfDay(doc.endDate) < now) return "completed";
  if (startOfDay(doc.startDate) > now) return "upcoming";
  return "ongoing";
}
