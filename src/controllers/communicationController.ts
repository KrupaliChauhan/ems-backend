import type { Request, Response } from "express";
import Department from "../models/Department";
import Designation from "../models/Designation";
import User from "../models/User";
import Project from "../models/Project";
import Announcement, { type Announcement as AnnouncementModel } from "../models/Announcement";
import AnnouncementReceipt from "../models/AnnouncementReceipt";
import CommunicationEvent, { type CommunicationEvent as CommunicationEventModel } from "../models/CommunicationEvent";
import EventInvitation from "../models/EventInvitation";
import AppNotification from "../models/AppNotification";
import Policy, { type Policy as PolicyModel } from "../models/Policy";
import PolicyAcknowledgment from "../models/PolicyAcknowledgment";
import PolicyVersionHistory, { type PolicyVersionHistory as PolicyVersionHistoryModel } from "../models/PolicyVersionHistory";
import {
  buildPolicyCode,
  computePolicyAcknowledgmentReport,
  computePolicyAcknowledgmentSummary,
  computeAnnouncementReport,
  computeEventReport,
  createPolicyVersionSnapshot,
  getAnnouncementLifecycleLabel,
  getEventLifecycleLabel,
  getUserProjectIds,
  hasMeaningfulPolicyChange,
  isAnnouncementCurrentlyVisible,
  isEventCurrentlyVisible,
  isUserTargeted,
  notifyPolicyUsers,
  normalizeTargeting,
  processCommunicationAutomation,
  sanitizeRichText,
  safelyDeleteFiles,
  syncAnnouncementDistribution,
  syncEventDistribution,
  buildUploadPayload,
  getReplacedUploadPaths
} from "../services/communicationService";
import {
  announcementInputSchema,
  announcementListQuerySchema,
  calendarQuerySchema,
  eventInputSchema,
  eventListQuerySchema,
  formatZodError,
  idParamSchema,
  notificationQuerySchema,
  policyInputSchema,
  policyListQuerySchema,
  policyReportQuerySchema,
  rsvpSchema
} from "../validation/communicationValidation";
import { COMMUNICATION_MANAGER_ROLES, hasAnyRole, type AppRole } from "../constants/roles";
import { endOfDay, startOfDay } from "../services/leaveService";
import mongoose from "mongoose";

type AuthUser = {
  id: string;
  role: AppRole;
};
type PopulatedIdNameRef = mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId | string; name?: string };
type PopulatedUserRef = mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId | string; name?: string; email?: string };
type PolicyListItemSource = {
  _id: mongoose.Types.ObjectId | string;
} & Pick<
  PolicyModel,
  "title" | "code" | "category" | "summary" | "versionNumber" | "isPublished" | "effectiveDate" | "createdAt" | "updatedAt"
>;
type PopulatedAnnouncementTargeting = AnnouncementModel["targeting"] & {
  departmentIds?: PopulatedIdNameRef[];
  designationIds?: PopulatedIdNameRef[];
  projectIds?: PopulatedIdNameRef[];
  userIds?: PopulatedUserRef[];
};
type AnnouncementAccessDoc = Omit<AnnouncementModel, "targeting" | "createdBy" | "updatedBy" | "publishedBy" | "archivedBy"> & {
  _id: mongoose.Types.ObjectId | string;
  targeting: PopulatedAnnouncementTargeting;
  createdBy?: PopulatedUserRef | null;
  updatedBy?: PopulatedUserRef | null;
  publishedBy?: PopulatedUserRef | null;
  archivedBy?: PopulatedUserRef | null;
};
type PopulatedEventTargeting = CommunicationEventModel["targeting"] & {
  departmentIds?: PopulatedIdNameRef[];
  designationIds?: PopulatedIdNameRef[];
  projectIds?: PopulatedIdNameRef[];
  userIds?: PopulatedUserRef[];
};
type EventAccessDoc = Omit<CommunicationEventModel, "targeting" | "organizerId"> & {
  _id: mongoose.Types.ObjectId | string;
  targeting: PopulatedEventTargeting;
  organizerId?: PopulatedUserRef | null;
};
type PolicyAccessDoc = Omit<PolicyModel, "createdBy" | "updatedBy" | "publishedBy"> & {
  _id: mongoose.Types.ObjectId | string;
  createdBy?: PopulatedUserRef | null;
  updatedBy?: PopulatedUserRef | null;
  publishedBy?: PopulatedUserRef | null;
};
type PolicyHistoryItem = {
  _id: mongoose.Types.ObjectId | string;
} & Omit<PolicyVersionHistoryModel, "changedBy"> & {
  changedBy?: PopulatedUserRef | null;
};

function getAuthUser(req: Request) {
  return (req as Request & { user?: AuthUser }).user;
}

function getRefId(value: mongoose.Types.ObjectId | string | null | undefined) {
  return value == null ? null : String(value);
}

function getPopulatedRefId(value: PopulatedIdNameRef | PopulatedUserRef | null | undefined) {
  if (!value) return null;
  if (typeof value === "object" && "_id" in value && value._id != null) {
    return String(value._id);
  }
  return String(value);
}

function getPopulatedRefName(value: PopulatedIdNameRef | PopulatedUserRef | null | undefined) {
  return typeof value === "object" && value && "name" in value ? value.name ?? "" : "";
}

function getPopulatedRefEmail(value: PopulatedUserRef | null | undefined) {
  return typeof value === "object" && value && "email" in value ? value.email ?? "" : "";
}

function toIdList(values: Array<PopulatedIdNameRef | PopulatedUserRef> | undefined) {
  return (values || []).map((item) => String(getPopulatedRefId(item) ?? ""));
}

function toNamedRefList(values: PopulatedIdNameRef[] | undefined) {
  return (values || []).map((item) => ({
    id: getPopulatedRefId(item),
    name: getPopulatedRefName(item),
  }));
}

function toUserRefList(values: PopulatedUserRef[] | undefined) {
  return (values || []).map((item) => ({
    id: getPopulatedRefId(item),
    name: getPopulatedRefName(item),
    email: getPopulatedRefEmail(item),
  }));
}

function parseBooleanString(value: unknown) {
  if (typeof value === "boolean") return value;
  return value === "true";
}

function parseJsonField(value: unknown) {
  if (typeof value === "string") {
    return JSON.parse(value) as unknown;
  }
  return value;
}

function parseAnnouncementInput(req: Request) {
  return announcementInputSchema.safeParse({
    ...req.body,
    content: sanitizeRichText(String(req.body.content || "")),
    targeting: parseJsonField(req.body.targeting),
    sendEmail: parseBooleanString(req.body.sendEmail),
    sendInAppNotification: parseBooleanString(req.body.sendInAppNotification),
    acknowledgementRequired: parseBooleanString(req.body.acknowledgementRequired),
    isPinned: parseBooleanString(req.body.isPinned),
    isUrgent: parseBooleanString(req.body.isUrgent)
  });
}

function parseEventInput(req: Request) {
  return eventInputSchema.safeParse({
    ...req.body,
    description: sanitizeRichText(String(req.body.description || "")),
    targeting: parseJsonField(req.body.targeting),
    reminderSettings: parseJsonField(req.body.reminderSettings),
    allDay: parseBooleanString(req.body.allDay),
    sendEmail: parseBooleanString(req.body.sendEmail),
    sendInAppNotification: parseBooleanString(req.body.sendInAppNotification)
  });
}

function parsePolicyInput(req: Request) {
  return policyInputSchema.safeParse({
    ...req.body,
    content: sanitizeRichText(String(req.body.content || "")),
    effectiveDate: req.body.effectiveDate === "" ? null : req.body.effectiveDate,
    isPublished: parseBooleanString(req.body.isPublished)
  });
}

function getCommunicationFiles(req: Request) {
  const files = req.files as
    | {
        attachments?: Express.Multer.File[];
        bannerImage?: Express.Multer.File[];
      }
    | undefined;

  return {
    attachments: files?.attachments ?? [],
    bannerImage: files?.bannerImage?.[0] ?? null
  };
}

async function ensureAnnouncementAccess(req: Request, announcementId: string) {
  const authUser = getAuthUser(req);
  if (!authUser) return null;

  const announcement = await Announcement.findOne({
    _id: announcementId,
    isDeleted: false
  })
    .populate("createdBy", "name email")
    .populate("updatedBy", "name email")
    .populate("publishedBy", "name email")
    .populate("archivedBy", "name email")
    .populate("targeting.departmentIds", "name")
    .populate("targeting.designationIds", "name")
    .populate("targeting.projectIds", "name")
    .populate("targeting.userIds", "name email")
    .lean();

  if (!announcement) return null;

  if (hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES)) {
    return announcement as AnnouncementAccessDoc;
  }

  const user = await User.findById(authUser.id).select("_id role department designation").lean();
  if (!user) return null;
  const projectIds = await getUserProjectIds(authUser.id);
  const canSee = await isUserTargeted({
    userId: authUser.id,
    role: user.role,
    departmentId: user.department ? String(user.department) : null,
    designationId: user.designation ? String(user.designation) : null,
    projectIds,
    targeting: normalizeTargeting({
      allEmployees: announcement.targeting.allEmployees,
      departmentIds: toIdList(announcement.targeting.departmentIds),
      roleKeys: announcement.targeting.roleKeys || [],
      designationIds: toIdList(announcement.targeting.designationIds),
      projectIds: toIdList(announcement.targeting.projectIds),
      userIds: toIdList(announcement.targeting.userIds)
    })
  });

  return canSee && isAnnouncementCurrentlyVisible(announcement) ? (announcement as AnnouncementAccessDoc) : null;
}

async function ensureEventAccess(req: Request, eventId: string) {
  const authUser = getAuthUser(req);
  if (!authUser) return null;

  const eventDoc = await CommunicationEvent.findOne({
    _id: eventId,
    isDeleted: false
  })
    .populate("organizerId", "name email")
    .populate("targeting.departmentIds", "name")
    .populate("targeting.designationIds", "name")
    .populate("targeting.projectIds", "name")
    .populate("targeting.userIds", "name email")
    .lean();

  if (!eventDoc) return null;

  if (hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES)) {
    return eventDoc as EventAccessDoc;
  }

  const user = await User.findById(authUser.id).select("_id role department designation").lean();
  if (!user) return null;
  const projectIds = await getUserProjectIds(authUser.id);
  const canSee = await isUserTargeted({
    userId: authUser.id,
    role: user.role,
    departmentId: user.department ? String(user.department) : null,
    designationId: user.designation ? String(user.designation) : null,
    projectIds,
    targeting: normalizeTargeting({
      allEmployees: eventDoc.targeting.allEmployees,
      departmentIds: toIdList(eventDoc.targeting.departmentIds),
      roleKeys: eventDoc.targeting.roleKeys || [],
      designationIds: toIdList(eventDoc.targeting.designationIds),
      projectIds: toIdList(eventDoc.targeting.projectIds),
      userIds: toIdList(eventDoc.targeting.userIds)
    })
  });

  return canSee && isEventCurrentlyVisible(eventDoc) ? (eventDoc as EventAccessDoc) : null;
}

async function ensurePolicyAccess(req: Request, policyId: string) {
  const authUser = getAuthUser(req);
  if (!authUser) return null;

  const policy = await Policy.findOne({
    _id: policyId,
    isDeleted: false
  })
    .populate("createdBy", "name email")
    .populate("updatedBy", "name email")
    .populate("publishedBy", "name email")
    .lean();

  if (!policy) return null;
  if (hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES)) {
    return policy as PolicyAccessDoc;
  }

  return policy.isPublished ? (policy as PolicyAccessDoc) : null;
}

function mapPolicyListItem(params: {
  policy: PolicyListItemSource;
  acknowledgment?: {
    acknowledgedAt?: Date | null;
  } | null;
  summary?: {
    totalEmployees: number;
    acknowledgedCount: number;
    pendingCount: number;
  } | null;
}) {
  return {
    id: params.policy._id,
    title: params.policy.title,
    code: params.policy.code,
    category: params.policy.category || "",
    summary: params.policy.summary || "",
    versionNumber: params.policy.versionNumber,
    isPublished: params.policy.isPublished,
    effectiveDate: params.policy.effectiveDate,
    acknowledgedAt: params.acknowledgment?.acknowledgedAt ?? null,
    acknowledgmentStatus: params.acknowledgment ? "ACKNOWLEDGED" : "PENDING",
    acknowledgmentSummary: params.summary
      ? {
          totalEmployees: params.summary.totalEmployees,
          acknowledgedCount: params.summary.acknowledgedCount,
          pendingCount: params.summary.pendingCount
        }
      : null,
    createdAt: params.policy.createdAt,
    updatedAt: params.policy.updatedAt
  };
}

export const getCommunicationMeta = async (_req: Request, res: Response) => {
  try {
    const [departments, designations, users, projects] = await Promise.all([
      Department.find({ isDeleted: false, status: "Active" }).select("_id name").sort({ name: 1 }).lean(),
      Designation.find({ isDeleted: false, status: "Active" })
        .select("_id name department")
        .populate("department", "name")
        .sort({ name: 1 })
        .lean(),
      User.find({ isDeleted: false, status: "Active" })
        .select("_id name email role department designation")
        .sort({ name: 1 })
        .lean(),
      Project.find({ isDeleted: false })
        .select("_id name employees")
        .sort({ name: 1 })
        .lean()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        roles: ["superadmin", "admin", "employee", "HR", "teamLeader"],
        departments: departments.map((item) => ({ id: item._id, name: item.name })),
        designations: designations.map((item) => ({
          id: item._id,
          name: item.name,
          departmentId:
            typeof item.department === "object" && item.department && "_id" in item.department
              ? item.department._id
              : item.department ?? null,
          departmentName:
            typeof item.department === "object" && item.department && "name" in item.department
              ? item.department.name ?? ""
              : ""
        })),
        users: users.map((item) => ({
          id: item._id,
          name: item.name,
          email: item.email,
          role: item.role,
          departmentId: item.department ?? null,
          designationId: item.designation ?? null
        })),
        projects: projects.map((item) => ({
          id: item._id,
          name: item.name,
          employeeIds: (item.employees || []).map((employeeId) => String(employeeId))
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch communication meta" });
  }
};

export const createAnnouncement = async (req: Request, res: Response) => {
  const files = getCommunicationFiles(req);
  try {
    const parsed = parseAnnouncementInput(req);
    if (!parsed.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const announcement = await Announcement.create({
      ...parsed.data,
      targeting: normalizeTargeting(parsed.data.targeting),
      attachments: files.attachments.map(buildUploadPayload),
      bannerImage: files.bannerImage ? buildUploadPayload(files.bannerImage) : null,
      createdBy: authUser.id,
      updatedBy: authUser.id,
      publishedBy: parsed.data.status === "published" ? authUser.id : null,
      publishedAt: parsed.data.status === "published" ? new Date() : null
    });

    if (announcement.status === "published" && announcement.publishDate <= new Date()) {
      await syncAnnouncementDistribution(announcement);
    }

    return res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: { id: announcement._id }
    });
  } catch (error) {
    await safelyDeleteFiles([
      ...files.attachments.map((item) => item.path),
      ...(files.bannerImage ? [files.bannerImage.path] : [])
    ]);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to create announcement"
    });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  const files = getCommunicationFiles(req);
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }

    const parsed = parseAnnouncementInput(req);
    if (!parsed.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const existing = await Announcement.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    });

    if (!existing) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const oldPaths = getReplacedUploadPaths({
      existingAttachments: existing.attachments,
      existingBannerPath: existing.bannerImage?.path ?? null,
      attachmentsReplaced: files.attachments.length > 0,
      bannerReplaced: Boolean(files.bannerImage)
    });

    existing.title = parsed.data.title;
    existing.summary = parsed.data.summary;
    existing.content = parsed.data.content;
    existing.announcementType = parsed.data.announcementType;
    existing.priority = parsed.data.priority;
    existing.publishDate = parsed.data.publishDate;
    existing.expiryDate = parsed.data.expiryDate ?? null;
    existing.set("targeting", normalizeTargeting(parsed.data.targeting));
    existing.sendEmail = parsed.data.sendEmail;
    existing.sendInAppNotification = parsed.data.sendInAppNotification;
    existing.acknowledgementRequired = parsed.data.acknowledgementRequired;
    existing.status = parsed.data.status;
    existing.isPinned = parsed.data.isPinned;
    existing.isUrgent = parsed.data.isUrgent;
    existing.set("updatedBy", authUser?.id ?? null);
    existing.set(
      "attachments",
      files.attachments.length > 0 ? files.attachments.map(buildUploadPayload) : existing.attachments,
    );
    existing.set("bannerImage", files.bannerImage ? buildUploadPayload(files.bannerImage) : existing.bannerImage);
    existing.distributionProcessedAt = null;

    if (existing.status === "published" && !existing.publishedAt) {
      existing.publishedAt = new Date();
      existing.set("publishedBy", authUser?.id ?? null);
    }

    await existing.save();

    if (oldPaths.length > 0) {
      await safelyDeleteFiles(oldPaths);
    }

    if (existing.status === "published" && existing.publishDate <= new Date()) {
      await syncAnnouncementDistribution(existing);
    }

    return res.status(200).json({
      success: true,
      message: "Announcement updated successfully"
    });
  } catch (error) {
    await safelyDeleteFiles([
      ...files.attachments.map((item) => item.path),
      ...(files.bannerImage ? [files.bannerImage.path] : [])
    ]);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to update announcement"
    });
  }
};

export const getAnnouncements = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const parsed = announcementListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement filters" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const page = parsed.data.page;
    const limit = parsed.data.limit;
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { isDeleted: false };

    if (parsed.data.search) filter.title = { $regex: new RegExp(parsed.data.search, "i") };
    if (parsed.data.announcementType !== "all") filter.announcementType = parsed.data.announcementType;
    if (parsed.data.priority !== "all") filter.priority = parsed.data.priority;
    if (parsed.data.status !== "all") filter.status = parsed.data.status;
    if (parsed.data.departmentId) filter["targeting.departmentIds"] = parsed.data.departmentId;
    if (parsed.data.fromDate) {
      filter.publishDate = {
        ...(filter.publishDate as Record<string, unknown> | undefined),
        $gte: startOfDay(new Date(parsed.data.fromDate))
      };
    }
    if (parsed.data.toDate) {
      filter.publishDate = {
        ...(filter.publishDate as Record<string, unknown> | undefined),
        $lte: endOfDay(new Date(parsed.data.toDate))
      };
    }

    const baseDocs = await Announcement.find(filter)
      .populate("targeting.departmentIds", "name")
      .sort({ isPinned: -1, publishDate: -1, createdAt: -1 })
      .lean();

    let docs = baseDocs;
    if (!isManager) {
      const user = await User.findById(authUser.id).select("_id role department designation").lean();
      if (!user) {
        return res.status(401).json({ success: false, message: "User not found" });
      }
      const projectIds = await getUserProjectIds(authUser.id);
      const filtered: typeof baseDocs = [];
      for (const doc of baseDocs) {
        const canSee = await isUserTargeted({
          userId: authUser.id,
          role: user.role,
          departmentId: user.department ? String(user.department) : null,
          designationId: user.designation ? String(user.designation) : null,
          projectIds,
          targeting: normalizeTargeting({
            allEmployees: doc.targeting.allEmployees,
            departmentIds: toIdList(doc.targeting.departmentIds),
            roleKeys: doc.targeting.roleKeys || [],
            designationIds: (doc.targeting.designationIds || []).map(String),
            projectIds: (doc.targeting.projectIds || []).map(String),
            userIds: (doc.targeting.userIds || []).map(String)
          })
        });

        if (canSee && isAnnouncementCurrentlyVisible(doc)) {
          filtered.push(doc);
        }
      }
      docs = filtered;
    }

    const total = docs.length;
    const items = docs.slice(skip, skip + limit);
    const receipts = !isManager
      ? await AnnouncementReceipt.find({
          announcementId: { $in: items.map((item) => item._id) },
          userId: authUser.id
        })
          .select("announcementId openedAt acknowledgedAt")
          .lean()
      : [];
    const receiptMap = new Map(receipts.map((item) => [String(item.announcementId), item]));

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item._id,
          title: item.title,
          summary: item.summary,
          announcementType: item.announcementType,
          priority: item.priority,
          status: item.status,
          lifecycleStatus: getAnnouncementLifecycleLabel(item),
          publishDate: item.publishDate,
          expiryDate: item.expiryDate,
          isPinned: item.isPinned,
          isUrgent: item.isUrgent,
          targeting: {
            allEmployees: item.targeting.allEmployees,
            departments: toNamedRefList(item.targeting.departmentIds),
            roles: item.targeting.roleKeys || []
          },
          attachments: item.attachments || [],
          bannerImage: item.bannerImage || null,
          readAt: receiptMap.get(String(item._id))?.openedAt ?? null,
          acknowledgedAt: receiptMap.get(String(item._id))?.acknowledgedAt ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch announcements"
    });
  }
};

export const getAnnouncementById = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }

    const authUser = getAuthUser(req);
    const announcement = await ensureAnnouncementAccess(req, parsedParam.data.id);
    if (!announcement || !authUser) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const report = isManager
      ? await computeAnnouncementReport(
          parsedParam.data.id,
          normalizeTargeting({
            allEmployees: announcement.targeting.allEmployees,
            departmentIds: toIdList(announcement.targeting.departmentIds),
            roleKeys: announcement.targeting.roleKeys || [],
            designationIds: (announcement.targeting.designationIds || []).map(String),
            projectIds: (announcement.targeting.projectIds || []).map(String),
            userIds: (announcement.targeting.userIds || []).map(String)
          })
        )
      : null;

    const receipt = await AnnouncementReceipt.findOne({
      announcementId: announcement._id,
      userId: authUser.id
    })
      .select("deliveredAt openedAt acknowledgedAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        id: announcement._id,
        title: announcement.title,
        summary: announcement.summary,
        content: announcement.content,
        announcementType: announcement.announcementType,
        priority: announcement.priority,
        status: announcement.status,
        lifecycleStatus: getAnnouncementLifecycleLabel(announcement),
        publishDate: announcement.publishDate,
        expiryDate: announcement.expiryDate,
        isPinned: announcement.isPinned,
        isUrgent: announcement.isUrgent,
        sendEmail: announcement.sendEmail,
        sendInAppNotification: announcement.sendInAppNotification,
        acknowledgementRequired: announcement.acknowledgementRequired,
        attachments: announcement.attachments || [],
        bannerImage: announcement.bannerImage || null,
        targeting: {
          allEmployees: announcement.targeting.allEmployees,
          departments: toNamedRefList(announcement.targeting.departmentIds),
          roles: announcement.targeting.roleKeys || [],
          designations: toNamedRefList(announcement.targeting.designationIds),
          projects: toNamedRefList(announcement.targeting.projectIds),
          users: toUserRefList(announcement.targeting.userIds)
        },
        report,
        receipt: receipt
          ? {
              deliveredAt: receipt.deliveredAt,
              readAt: receipt.openedAt,
              acknowledgedAt: receipt.acknowledgedAt
            }
          : null,
        createdAt: announcement.createdAt,
        updatedAt: announcement.updatedAt,
        createdBy: announcement.createdBy,
        updatedBy: announcement.updatedBy,
        publishedBy: announcement.publishedBy,
        archivedBy: announcement.archivedBy
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch announcement"
    });
  }
};

export const markAnnouncementRead = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    const announcement = await ensureAnnouncementAccess(req, parsedParam.data.id);
    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    await AnnouncementReceipt.findOneAndUpdate(
      {
        announcementId: parsedParam.data.id,
        userId: authUser.id
      },
      {
        $setOnInsert: {
          announcementId: parsedParam.data.id,
          userId: authUser.id,
          deliveredAt: new Date()
        },
        $set: {
          openedAt: new Date()
        }
      },
      { upsert: true, returnDocument: "after" }
    );

    return res.status(200).json({ success: true, message: "Announcement marked as read" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update announcement receipt" });
  }
};

export const acknowledgeAnnouncement = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }
    const announcement = await ensureAnnouncementAccess(req, parsedParam.data.id);
    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }
    if (!announcement.acknowledgementRequired) {
      return res.status(400).json({ success: false, message: "Acknowledgement is not required for this announcement" });
    }

    await AnnouncementReceipt.findOneAndUpdate(
      {
        announcementId: parsedParam.data.id,
        userId: authUser.id
      },
      {
        $setOnInsert: {
          announcementId: parsedParam.data.id,
          userId: authUser.id,
          deliveredAt: new Date()
        },
        $set: {
          openedAt: new Date(),
          acknowledgedAt: new Date()
        }
      },
      { upsert: true, returnDocument: "after" }
    );

    return res.status(200).json({ success: true, message: "Announcement acknowledged successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to acknowledge announcement" });
  }
};

export const publishAnnouncement = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    const announcement = await Announcement.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    });

    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    announcement.status = "published";
    if (announcement.publishDate > new Date()) {
      announcement.publishDate = new Date();
    }
    announcement.publishedAt = new Date();
    announcement.set("publishedBy", authUser?.id ?? null);
    announcement.set("updatedBy", authUser?.id ?? null);
    announcement.distributionProcessedAt = null;
    await announcement.save();

    if (announcement.publishDate <= new Date()) {
      await syncAnnouncementDistribution(announcement);
    }

    return res.status(200).json({ success: true, message: "Announcement published successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to publish announcement" });
  }
};

export const archiveAnnouncement = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    const updated = await Announcement.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        status: "archived",
        archivedAt: new Date(),
        archivedBy: authUser?.id ?? null,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    return res.status(200).json({ success: true, message: "Announcement archived successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to archive announcement" });
  }
};

export const restoreAnnouncement = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    const updated = await Announcement.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        status: "draft",
        archivedAt: null,
        archivedBy: null,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    return res.status(200).json({ success: true, message: "Announcement restored successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to restore announcement" });
  }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid announcement id" });
    }
    const authUser = getAuthUser(req);
    const updated = await Announcement.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    return res.status(200).json({ success: true, message: "Announcement deleted successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete announcement" });
  }
};

export const createEvent = async (req: Request, res: Response) => {
  const files = getCommunicationFiles(req);
  try {
    const parsed = parseEventInput(req);
    if (!parsed.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const creator = await User.findById(authUser?.id).select("name").lean();

    const eventDoc = await CommunicationEvent.create({
      ...parsed.data,
      targeting: normalizeTargeting(parsed.data.targeting),
      attachments: files.attachments.map(buildUploadPayload),
      bannerImage: files.bannerImage ? buildUploadPayload(files.bannerImage) : null,
      organizerId: authUser?.id,
      organizerName: creator?.name || "Organizer",
      createdBy: authUser?.id,
      updatedBy: authUser?.id,
      publishedBy: parsed.data.status === "published" ? authUser?.id : null,
      publishedAt: parsed.data.status === "published" ? new Date() : null
    });

    if (eventDoc.status === "published" && eventDoc.publishDate <= new Date()) {
      await syncEventDistribution(eventDoc);
    }

    return res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: { id: eventDoc._id }
    });
  } catch (error) {
    await safelyDeleteFiles([
      ...files.attachments.map((item) => item.path),
      ...(files.bannerImage ? [files.bannerImage.path] : [])
    ]);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to create event"
    });
  }
};

export const updateEvent = async (req: Request, res: Response) => {
  const files = getCommunicationFiles(req);
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }

    const parsed = parseEventInput(req);
    if (!parsed.success) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const existing = await CommunicationEvent.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    });

    if (!existing) {
      await safelyDeleteFiles([
        ...files.attachments.map((item) => item.path),
        ...(files.bannerImage ? [files.bannerImage.path] : [])
      ]);
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const oldPaths = getReplacedUploadPaths({
      existingAttachments: existing.attachments,
      existingBannerPath: existing.bannerImage?.path ?? null,
      attachmentsReplaced: files.attachments.length > 0,
      bannerReplaced: Boolean(files.bannerImage)
    });

    existing.title = parsed.data.title;
    existing.category = parsed.data.category;
    existing.description = parsed.data.description;
    existing.publishDate = parsed.data.publishDate;
    existing.startDate = parsed.data.startDate;
    existing.endDate = parsed.data.endDate;
    existing.startTime = parsed.data.startTime;
    existing.endTime = parsed.data.endTime;
    existing.allDay = parsed.data.allDay;
    existing.location = parsed.data.location;
    existing.mode = parsed.data.mode;
    existing.meetingLink = parsed.data.meetingLink;
    existing.set("targeting", normalizeTargeting(parsed.data.targeting));
    existing.set("reminderSettings", parsed.data.reminderSettings.map((item) => ({
      ...item,
      processedAt: null
    })));
    existing.sendEmail = parsed.data.sendEmail;
    existing.sendInAppNotification = parsed.data.sendInAppNotification;
    existing.status = parsed.data.status;
    existing.set("updatedBy", authUser?.id ?? null);
    existing.set(
      "attachments",
      files.attachments.length > 0 ? files.attachments.map(buildUploadPayload) : existing.attachments,
    );
    existing.set("bannerImage", files.bannerImage ? buildUploadPayload(files.bannerImage) : existing.bannerImage);
    existing.distributionProcessedAt = null;

    if (existing.status === "published" && !existing.publishedAt) {
      existing.publishedAt = new Date();
      existing.set("publishedBy", authUser?.id ?? null);
    }

    await existing.save();

    if (oldPaths.length > 0) {
      await safelyDeleteFiles(oldPaths);
    }

    if (existing.status === "published" && existing.publishDate <= new Date()) {
      await syncEventDistribution(existing);
    }

    return res.status(200).json({ success: true, message: "Event updated successfully" });
  } catch (error) {
    await safelyDeleteFiles([
      ...files.attachments.map((item) => item.path),
      ...(files.bannerImage ? [files.bannerImage.path] : [])
    ]);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to update event"
    });
  }
};

export const getEvents = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const parsed = eventListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid event filters" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const page = parsed.data.page;
    const limit = parsed.data.limit;
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { isDeleted: false };

    if (parsed.data.search) filter.title = { $regex: new RegExp(parsed.data.search, "i") };
    if (parsed.data.category !== "all") filter.category = parsed.data.category;
    if (parsed.data.status !== "all") filter.status = parsed.data.status;
    if (parsed.data.departmentId) filter["targeting.departmentIds"] = parsed.data.departmentId;
    if (parsed.data.date) {
      filter.startDate = {
        ...(filter.startDate as Record<string, unknown> | undefined),
        $lte: endOfDay(new Date(parsed.data.date))
      };
      filter.endDate = {
        ...(filter.endDate as Record<string, unknown> | undefined),
        $gte: startOfDay(new Date(parsed.data.date))
      };
    }
    if (parsed.data.fromDate) {
      filter.startDate = {
        ...(filter.startDate as Record<string, unknown> | undefined),
        $gte: startOfDay(new Date(parsed.data.fromDate))
      };
    }
    if (parsed.data.toDate) {
      filter.endDate = {
        ...(filter.endDate as Record<string, unknown> | undefined),
        $lte: endOfDay(new Date(parsed.data.toDate))
      };
    }

    const baseDocs = await CommunicationEvent.find(filter)
      .populate("targeting.departmentIds", "name")
      .sort({ startDate: 1, createdAt: -1 })
      .lean();

    let docs = baseDocs;
    if (!isManager) {
      const user = await User.findById(authUser.id).select("_id role department designation").lean();
      if (!user) {
        return res.status(401).json({ success: false, message: "User not found" });
      }
      const projectIds = await getUserProjectIds(authUser.id);
      const filtered: typeof baseDocs = [];
      for (const doc of baseDocs) {
        const canSee = await isUserTargeted({
          userId: authUser.id,
          role: user.role,
          departmentId: user.department ? String(user.department) : null,
          designationId: user.designation ? String(user.designation) : null,
          projectIds,
          targeting: normalizeTargeting({
            allEmployees: doc.targeting.allEmployees,
            departmentIds: toIdList(doc.targeting.departmentIds),
            roleKeys: doc.targeting.roleKeys || [],
            designationIds: (doc.targeting.designationIds || []).map(String),
            projectIds: (doc.targeting.projectIds || []).map(String),
            userIds: (doc.targeting.userIds || []).map(String)
          })
        });

        if (canSee && isEventCurrentlyVisible(doc)) {
          filtered.push(doc);
        }
      }
      docs = filtered;
    }

    const total = docs.length;
    const items = docs.slice(skip, skip + limit);
    const invitations = !isManager
      ? await EventInvitation.find({
          eventId: { $in: items.map((item) => item._id) },
          userId: authUser.id
        })
          .select("eventId status respondedAt")
          .lean()
      : [];

    const invitationMap = new Map(invitations.map((item) => [String(item.eventId), item]));

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item._id,
          title: item.title,
          category: item.category,
          description: item.description,
          publishDate: item.publishDate,
          startDate: item.startDate,
          endDate: item.endDate,
          startTime: item.startTime,
          endTime: item.endTime,
          allDay: item.allDay,
          location: item.location,
          mode: item.mode,
          status: item.status,
          lifecycleStatus: getEventLifecycleLabel(item),
          attachments: item.attachments || [],
          bannerImage: item.bannerImage || null,
          rsvpStatus: invitationMap.get(String(item._id))?.status ?? "Pending",
          respondedAt: invitationMap.get(String(item._id))?.respondedAt ?? null,
          targeting: {
            allEmployees: item.targeting.allEmployees,
            departments: toNamedRefList(item.targeting.departmentIds)
          }
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch events"
    });
  }
};

export const getEventById = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const eventDoc = await ensureEventAccess(req, parsedParam.data.id);
    if (!eventDoc || !authUser) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const report = isManager
      ? await computeEventReport(
          parsedParam.data.id,
          normalizeTargeting({
            allEmployees: eventDoc.targeting.allEmployees,
            departmentIds: toIdList(eventDoc.targeting.departmentIds),
            roleKeys: eventDoc.targeting.roleKeys || [],
            designationIds: (eventDoc.targeting.designationIds || []).map(String),
            projectIds: (eventDoc.targeting.projectIds || []).map(String),
            userIds: (eventDoc.targeting.userIds || []).map(String)
          })
        )
      : null;

    const invitation = await EventInvitation.findOne({
      eventId: parsedParam.data.id,
      userId: authUser.id
    })
      .select("status openedAt respondedAt")
      .lean();

    if (!isManager && invitation && !invitation.openedAt) {
      await EventInvitation.findOneAndUpdate(
        { eventId: parsedParam.data.id, userId: authUser.id },
        { openedAt: new Date() }
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        id: eventDoc._id,
        title: eventDoc.title,
        category: eventDoc.category,
        description: eventDoc.description,
        publishDate: eventDoc.publishDate,
        startDate: eventDoc.startDate,
        endDate: eventDoc.endDate,
        startTime: eventDoc.startTime,
        endTime: eventDoc.endTime,
        allDay: eventDoc.allDay,
        location: eventDoc.location,
        mode: eventDoc.mode,
        meetingLink: eventDoc.meetingLink,
        organizer: eventDoc.organizerId
          ? {
              id: getPopulatedRefId(eventDoc.organizerId),
              name: getPopulatedRefName(eventDoc.organizerId) || eventDoc.organizerName,
              email: getPopulatedRefEmail(eventDoc.organizerId)
            }
          : {
              id: null,
              name: eventDoc.organizerName,
              email: ""
            },
        reminderSettings: eventDoc.reminderSettings || [],
        status: eventDoc.status,
        lifecycleStatus: getEventLifecycleLabel(eventDoc),
        sendEmail: eventDoc.sendEmail,
        sendInAppNotification: eventDoc.sendInAppNotification,
        attachments: eventDoc.attachments || [],
        bannerImage: eventDoc.bannerImage || null,
        targeting: {
          allEmployees: eventDoc.targeting.allEmployees,
          departments: toNamedRefList(eventDoc.targeting.departmentIds),
          roles: eventDoc.targeting.roleKeys || [],
          designations: toNamedRefList(eventDoc.targeting.designationIds),
          projects: toNamedRefList(eventDoc.targeting.projectIds),
          users: toUserRefList(eventDoc.targeting.userIds)
        },
        report,
        invitation: invitation
          ? {
              status: invitation.status,
              openedAt: invitation.openedAt,
              respondedAt: invitation.respondedAt
            }
          : null
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch event"
    });
  }
};

export const publishEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const eventDoc = await CommunicationEvent.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    });

    if (!eventDoc) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    eventDoc.status = "published";
    eventDoc.publishedAt = new Date();
    eventDoc.set("publishedBy", authUser?.id ?? null);
    eventDoc.set("updatedBy", authUser?.id ?? null);
    eventDoc.distributionProcessedAt = null;
    await eventDoc.save();

    if (eventDoc.publishDate <= new Date()) {
      await syncEventDistribution(eventDoc);
    }

    return res.status(200).json({ success: true, message: "Event published successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to publish event" });
  }
};

export const cancelEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const updated = await CommunicationEvent.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: authUser?.id ?? null,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({ success: true, message: "Event cancelled successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to cancel event" });
  }
};

export const archiveEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const updated = await CommunicationEvent.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        status: "archived",
        archivedAt: new Date(),
        archivedBy: authUser?.id ?? null,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({ success: true, message: "Event archived successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to archive event" });
  }
};

export const restoreEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const updated = await CommunicationEvent.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        status: "draft",
        archivedAt: null,
        archivedBy: null,
        updatedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({ success: true, message: "Event restored successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to restore event" });
  }
};
export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const authUser = getAuthUser(req);
    const updated = await CommunicationEvent.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: authUser?.id ?? null
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({ success: true, message: "Event deleted successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete event" });
  }
};

export const rsvpToEvent = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const parsed = rsvpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid RSVP status" });
    }
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const eventDoc = await ensureEventAccess(req, parsedParam.data.id);
    if (!eventDoc) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    await EventInvitation.findOneAndUpdate(
      {
        eventId: parsedParam.data.id,
        userId: authUser.id
      },
      {
        $setOnInsert: {
          eventId: parsedParam.data.id,
          userId: authUser.id
        },
        $set: {
          status: parsed.data.status,
          openedAt: new Date(),
          respondedAt: new Date()
        }
      },
      { upsert: true, returnDocument: "after" }
    );

    return res.status(200).json({ success: true, message: "RSVP updated successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update RSVP" });
  }
};

export const getEventCalendar = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const parsed = calendarQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid calendar range" });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const rangeFilter = {
      isDeleted: false,
      startDate: { $lte: endOfDay(parsed.data.toDate) },
      endDate: { $gte: startOfDay(parsed.data.fromDate) }
    };

    const baseDocs = await CommunicationEvent.find(rangeFilter)
      .sort({ startDate: 1, createdAt: -1 })
      .lean();

    let docs = baseDocs;
    if (!isManager) {
      const user = await User.findById(authUser.id).select("_id role department designation").lean();
      if (!user) {
        return res.status(401).json({ success: false, message: "User not found" });
      }
      const projectIds = await getUserProjectIds(authUser.id);
      const filtered: typeof baseDocs = [];
      for (const doc of baseDocs) {
        const canSee = await isUserTargeted({
          userId: authUser.id,
          role: user.role,
          departmentId: user.department ? String(user.department) : null,
          designationId: user.designation ? String(user.designation) : null,
          projectIds,
          targeting: normalizeTargeting({
            allEmployees: doc.targeting.allEmployees,
            departmentIds: (doc.targeting.departmentIds || []).map(String),
            roleKeys: doc.targeting.roleKeys || [],
            designationIds: (doc.targeting.designationIds || []).map(String),
            projectIds: (doc.targeting.projectIds || []).map(String),
            userIds: (doc.targeting.userIds || []).map(String)
          })
        });

        if (canSee && isEventCurrentlyVisible(doc)) {
          filtered.push(doc);
        }
      }
      docs = filtered;
    }

    return res.status(200).json({
      success: true,
      data: {
        items: docs.map((item) => ({
          id: item._id,
          title: item.title,
          category: item.category,
          status: item.status,
          lifecycleStatus: getEventLifecycleLabel(item),
          startDate: item.startDate,
          endDate: item.endDate,
          startTime: item.startTime,
          endTime: item.endTime,
          allDay: item.allDay,
          location: item.location,
          mode: item.mode
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch event calendar" });
  }
};

export const createPolicy = async (req: Request, res: Response) => {
  try {
    const parsed = parsePolicyInput(req);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const code = buildPolicyCode(parsed.data.title, parsed.data.category);
    const existing = await Policy.findOne({ code, isDeleted: false }).select("_id").lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An active policy with the same title/category already exists. Update the existing policy instead."
      });
    }

    const policy = await Policy.create({
      title: parsed.data.title,
      code,
      category: parsed.data.category || "",
      summary: parsed.data.summary || "",
      content: parsed.data.content,
      versionNumber: 1,
      isPublished: parsed.data.isPublished,
      effectiveDate: parsed.data.effectiveDate ?? null,
      createdBy: authUser.id,
      updatedBy: authUser.id,
      publishedBy: parsed.data.isPublished ? authUser.id : null,
      publishedAt: parsed.data.isPublished ? new Date() : null
    });

    if (policy.isPublished) {
      await notifyPolicyUsers({ policy, reason: "published" });
    }

    return res.status(201).json({
      success: true,
      message: "Policy created successfully",
      data: { id: policy._id }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to create policy"
    });
  }
};

export const updatePolicy = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid policy id" });
    }

    const parsed = parsePolicyInput(req);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const policy = await Policy.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    });

    if (!policy) {
      return res.status(404).json({ success: false, message: "Policy not found" });
    }

    const meaningfulChange = hasMeaningfulPolicyChange(policy, parsed.data);
    const publishChanged = policy.isPublished !== parsed.data.isPublished;

    if (meaningfulChange) {
      await createPolicyVersionSnapshot({
        policy,
        changedBy: authUser.id,
        changeSummary: parsed.data.changeSummary || ""
      });
      policy.versionNumber += 1;
    }

    policy.title = parsed.data.title;
    policy.category = parsed.data.category || "";
    policy.summary = parsed.data.summary || "";
    policy.content = parsed.data.content;
    policy.effectiveDate = parsed.data.effectiveDate ?? null;
    policy.isPublished = parsed.data.isPublished;
    policy.set("updatedBy", authUser.id);

    if (parsed.data.isPublished && !policy.publishedAt) {
      policy.publishedAt = new Date();
      policy.set("publishedBy", authUser.id);
    }

    if (!parsed.data.isPublished && policy.publishedAt) {
      policy.set("unpublishedAt", new Date());
      policy.set("unpublishedBy", authUser.id);
    }

    await policy.save();

    if (policy.isPublished && (meaningfulChange || publishChanged)) {
      await notifyPolicyUsers({
        policy,
        reason: meaningfulChange ? "updated" : "published"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Policy updated successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to update policy"
    });
  }
};

export const getPolicies = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const parsed = policyListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid policy filters" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);
    const filter: Record<string, unknown> = { isDeleted: false };
    if (!isManager) {
      filter.isPublished = true;
    } else if (parsed.data.isPublished !== "all") {
      filter.isPublished = parsed.data.isPublished === "true";
    }
    if (parsed.data.search) {
      filter.$or = [
        { title: { $regex: new RegExp(parsed.data.search, "i") } },
        { category: { $regex: new RegExp(parsed.data.search, "i") } },
        { summary: { $regex: new RegExp(parsed.data.search, "i") } }
      ];
    }
    if (parsed.data.category !== "all") {
      filter.category = parsed.data.category;
    }

    const page = parsed.data.page;
    const limit = parsed.data.limit;
    const skip = (page - 1) * limit;

    const [policies, total] = await Promise.all([
      Policy.find(filter).sort({ isPublished: -1, updatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Policy.countDocuments(filter)
    ]);

    let acknowledgmentMap = new Map<string, { acknowledgedAt?: Date | null }>();
    if (!isManager && policies.length > 0) {
      const acknowledgments = await PolicyAcknowledgment.find({
        employeeId: authUser.id,
        $or: policies.map((policy) => ({
          policyId: policy._id,
          versionNumber: policy.versionNumber
        }))
      })
        .select("policyId acknowledgedAt")
        .lean();

      acknowledgmentMap = new Map(
        acknowledgments.map((item) => [String(item.policyId), { acknowledgedAt: item.acknowledgedAt }])
      );
    }

    let summaryMap = new Map<string, { totalEmployees: number; acknowledgedCount: number; pendingCount: number }>();
    if (isManager) {
      const summaries = await Promise.all(
        policies.map(async (policy) => ({
          policyId: String(policy._id),
          summary: await computePolicyAcknowledgmentSummary(String(policy._id), policy.versionNumber)
        }))
      );
      summaryMap = new Map(summaries.map((item) => [item.policyId, item.summary]));
    }

    return res.status(200).json({
      success: true,
      data: {
        items: policies.map((policy) =>
          mapPolicyListItem({
            policy,
            acknowledgment: acknowledgmentMap.get(String(policy._id)) ?? null,
            summary: summaryMap.get(String(policy._id)) ?? null
          })
        ),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch policies"
    });
  }
};

export const getPolicyById = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid policy id" });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const policy = await ensurePolicyAccess(req, parsedParam.data.id);
    if (!policy) {
      return res.status(404).json({ success: false, message: "Policy not found" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);

    const [acknowledgment, report, history] = await Promise.all([
      !isManager
        ? PolicyAcknowledgment.findOne({
            policyId: policy._id,
            employeeId: authUser.id,
            versionNumber: policy.versionNumber
          })
            .select("acknowledgedAt status")
            .lean()
        : Promise.resolve(null),
      isManager
        ? computePolicyAcknowledgmentReport({
            policyId: String(policy._id),
            versionNumber: policy.versionNumber,
            status: "all"
          })
        : Promise.resolve(null),
      isManager
        ? PolicyVersionHistory.find({ policyId: policy._id }).sort({ versionNumber: -1 }).populate("changedBy", "name email").lean()
        : Promise.resolve([])
    ]);

    return res.status(200).json({
      success: true,
      data: {
        id: policy._id,
        title: policy.title,
        code: policy.code,
        category: policy.category || "",
        summary: policy.summary || "",
        content: policy.content,
        versionNumber: policy.versionNumber,
        isPublished: policy.isPublished,
        effectiveDate: policy.effectiveDate,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
        acknowledgmentStatus: acknowledgment ? "ACKNOWLEDGED" : "PENDING",
        acknowledgedAt: acknowledgment?.acknowledgedAt ?? null,
        acknowledgmentSummary: report
          ? {
              totalEmployees: report.totalEmployees,
              acknowledgedCount: report.acknowledgedCount,
              pendingCount: report.pendingCount
            }
          : null,
        report,
        history: history.map((item: PolicyHistoryItem) => ({
          id: item._id,
          versionNumber: item.versionNumber,
          title: item.title,
          category: item.category,
          summary: item.summary,
          content: item.content,
          effectiveDate: item.effectiveDate,
          isPublished: item.isPublished,
          changeSummary: item.changeSummary || "",
          changedAt: item.changedAt,
          changedBy: item.changedBy
            ? {
                id: getPopulatedRefId(item.changedBy),
                name: getPopulatedRefName(item.changedBy),
                email: getPopulatedRefEmail(item.changedBy)
              }
            : null
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch policy"
    });
  }
};

export const acknowledgePolicy = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid policy id" });
    }

    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    if (hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES)) {
      return res.status(403).json({ success: false, message: "Managers cannot acknowledge policies as employees." });
    }

    const policy = await ensurePolicyAccess(req, parsedParam.data.id);
    if (!policy || !policy.isPublished) {
      return res.status(404).json({ success: false, message: "Policy not found" });
    }

    const existing = await PolicyAcknowledgment.findOne({
      policyId: policy._id,
      employeeId: authUser.id,
      versionNumber: policy.versionNumber
    })
      .select("_id")
      .lean();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "You have already acknowledged this policy version."
      });
    }

    await PolicyAcknowledgment.create({
      policyId: policy._id,
      employeeId: authUser.id,
      versionNumber: policy.versionNumber,
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date()
    });

    return res.status(200).json({
      success: true,
      message: "Policy acknowledged successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to acknowledge policy"
    });
  }
};

export const getPolicyAcknowledgmentReport = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid policy id" });
    }

    const parsedQuery = policyReportQuerySchema.safeParse({
      ...req.query,
      policyId: parsedParam.data.id
    });

    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, message: "Invalid policy report filters" });
    }

    const policy = await Policy.findOne({
      _id: parsedParam.data.id,
      isDeleted: false
    })
      .select("_id versionNumber title")
      .lean();

    if (!policy) {
      return res.status(404).json({ success: false, message: "Policy not found" });
    }

    const report = await computePolicyAcknowledgmentReport({
      policyId: String(policy._id),
      versionNumber: policy.versionNumber,
      departmentId: parsedQuery.data.departmentId || undefined,
      employeeId: parsedQuery.data.employeeId || undefined,
      status: parsedQuery.data.status
    });

    return res.status(200).json({
      success: true,
      data: {
        policyId: String(policy._id),
        policyTitle: policy.title,
        versionNumber: policy.versionNumber,
        ...report
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch policy acknowledgment report"
    });
  }
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const parsed = notificationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid notification query" });
    }

    const readRetentionCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await AppNotification.deleteMany({
      userId: authUser.id,
      readAt: { $ne: null, $lte: readRetentionCutoff }
    });

    const [items, unreadCount] = await Promise.all([
      AppNotification.find({ userId: authUser.id })
        .sort({ createdAt: -1 })
        .limit(parsed.data.limit)
        .lean(),
      AppNotification.countDocuments({ userId: authUser.id, readAt: null })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item._id,
          title: item.title,
          message: item.message,
          type: item.type,
          link: item.link,
          readAt: item.readAt,
          createdAt: item.createdAt
        })),
        unreadCount
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

export const markNotificationRead = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const updated = await AppNotification.findOneAndUpdate(
      { _id: parsedParam.data.id, userId: authUser.id },
      { readAt: new Date() },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification marked as read" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update notification" });
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    await AppNotification.updateMany(
      { userId: authUser.id, readAt: null },
      { readAt: new Date() }
    );

    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
};

export const getCommunicationDashboard = async (req: Request, res: Response) => {
  try {
    await processCommunicationAutomation();
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const isManager = hasAnyRole(authUser.role, COMMUNICATION_MANAGER_ROLES);

    if (isManager) {
      const now = new Date();
      const [announcementCount, unreadAnnouncementCount, upcomingEvents, invitationSummary, latestAnnouncements] =
        await Promise.all([
          Announcement.countDocuments({ isDeleted: false }),
          AnnouncementReceipt.countDocuments({ openedAt: null }),
          CommunicationEvent.countDocuments({
            isDeleted: false,
            status: "published",
            startDate: { $gte: startOfDay(now) }
          }),
          EventInvitation.aggregate([
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 }
              }
            }
          ]),
          Announcement.find({
            isDeleted: false,
            status: "published"
          })
            .sort({ publishDate: -1 })
            .limit(5)
            .select("_id title summary publishDate isPinned priority")
            .lean()
        ]);

      const participationSummary = invitationSummary.reduce<Record<string, number>>((acc, item) => {
        acc[String(item._id)] = Number(item.count);
        return acc;
      }, {});

      return res.status(200).json({
        success: true,
        data: {
          roleView: "manager",
          totals: {
            totalAnnouncements: announcementCount,
            unreadAnnouncements: unreadAnnouncementCount,
            upcomingEvents
          },
          participationSummary: {
            accepted: participationSummary.Accepted || 0,
            declined: participationSummary.Declined || 0,
            maybe: participationSummary.Maybe || 0,
            pending: participationSummary.Pending || 0
          },
          latestAnnouncements: latestAnnouncements.map((item) => ({
            id: item._id,
            title: item.title,
            summary: item.summary,
            publishDate: item.publishDate,
            isPinned: item.isPinned,
            priority: item.priority
          }))
        }
      });
    }

    const user = await User.findById(authUser.id).select("_id role department designation").lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    const projectIds = await getUserProjectIds(authUser.id);
    const allAnnouncements = await Announcement.find({
      isDeleted: false,
      status: "published"
    })
      .sort({ isPinned: -1, publishDate: -1 })
      .limit(20)
      .lean();

    const targetedAnnouncements: typeof allAnnouncements = [];
    for (const item of allAnnouncements) {
      const canSee = await isUserTargeted({
        userId: authUser.id,
        role: user.role,
        departmentId: user.department ? String(user.department) : null,
        designationId: user.designation ? String(user.designation) : null,
        projectIds,
        targeting: normalizeTargeting({
          allEmployees: item.targeting.allEmployees,
          departmentIds: (item.targeting.departmentIds || []).map(String),
          roleKeys: item.targeting.roleKeys || [],
          designationIds: (item.targeting.designationIds || []).map(String),
          projectIds: (item.targeting.projectIds || []).map(String),
          userIds: (item.targeting.userIds || []).map(String)
        })
      });
      if (canSee && isAnnouncementCurrentlyVisible(item)) {
        targetedAnnouncements.push(item);
      }
    }

    const upcomingEvents = await CommunicationEvent.find({
      isDeleted: false,
      status: { $in: ["published", "completed"] },
      endDate: { $gte: startOfDay(new Date()) }
    })
      .sort({ startDate: 1 })
      .limit(20)
      .lean();

    const targetedEvents: typeof upcomingEvents = [];
    for (const eventDoc of upcomingEvents) {
      const canSee = await isUserTargeted({
        userId: authUser.id,
        role: user.role,
        departmentId: user.department ? String(user.department) : null,
        designationId: user.designation ? String(user.designation) : null,
        projectIds,
        targeting: normalizeTargeting({
          allEmployees: eventDoc.targeting.allEmployees,
          departmentIds: (eventDoc.targeting.departmentIds || []).map(String),
          roleKeys: eventDoc.targeting.roleKeys || [],
          designationIds: (eventDoc.targeting.designationIds || []).map(String),
          projectIds: (eventDoc.targeting.projectIds || []).map(String),
          userIds: (eventDoc.targeting.userIds || []).map(String)
        })
      });
      if (canSee && isEventCurrentlyVisible(eventDoc)) {
        targetedEvents.push(eventDoc);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        roleView: "employee",
        latestAnnouncements: targetedAnnouncements.slice(0, 5).map((item) => ({
          id: item._id,
          title: item.title,
          summary: item.summary,
          publishDate: item.publishDate,
          isPinned: item.isPinned,
          priority: item.priority
        })),
        pinnedAnnouncements: targetedAnnouncements
          .filter((item) => item.isPinned)
          .slice(0, 5)
          .map((item) => ({
            id: item._id,
            title: item.title,
            summary: item.summary,
            publishDate: item.publishDate,
            isPinned: item.isPinned,
            priority: item.priority
          })),
        upcomingEvents: targetedEvents.slice(0, 6).map((item) => ({
          id: item._id,
          title: item.title,
          startDate: item.startDate,
          endDate: item.endDate,
          startTime: item.startTime,
          endTime: item.endTime,
          mode: item.mode,
          location: item.location
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch communication dashboard"
    });
  }
};
