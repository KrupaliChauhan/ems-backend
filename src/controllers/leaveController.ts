import fs from "node:fs/promises";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import LeaveType, { type LeaveType as LeaveTypeModel } from "../models/LeaveType";
import LeaveBalance from "../models/LeaveBalance";
import Holiday from "../models/Holiday";
import LeaveRequest, { type LeaveRequest as LeaveRequestModel } from "../models/LeaveRequest";
import User from "../models/User";
import Department from "../models/Department";
import {
  buildBalanceSummary,
  calculateLeaveDays,
  canCancelLeaveRequest,
  ensureLeaveBalance,
  ensureNoOverlap,
  getCycleParts,
  getAllowedLeaveActions,
  getHolidayDateKeysInRange,
  hasLeaveDatePassed,
  hasLeaveStarted,
  processCarryForward,
  processMonthlyAccrual,
  purgeExpiredUnapprovedLeaveRequests,
  startOfDay,
  toYmd,
  validateEmployeeAccess
} from "../services/leaveService";
import { getTeamMemberIdsByLeader } from "../services/userService";
import { upsertAppNotifications } from "../services/communicationService";
import { recordAuditLog } from "../services/auditService";
import {
  buildHolidayPayload,
  getApplicableHolidays,
  listScopedHolidays,
  validateHolidayDepartment
} from "../services/holidayService";
import {
  holidayListQuerySchema,
  holidaySchema,
  formatZodError,
  idParamSchema,
  leaveActionSchema,
  leaveApplySchema,
  leaveBalanceQuerySchema,
  leaveCalendarQuerySchema,
  leaveCancelSchema,
  leaveListQuerySchema,
  leaveTypeListQuerySchema,
  leaveProcessSchema,
  leaveTypeSchema
} from "../validation/leaveValidation";
import { getLeaveAttachmentPublicUrl } from "../middleware/uploadLeaveAttachment";
import {
  hasAnyRole,
  LEAVE_HOLIDAY_MANAGER_ROLES,
  LEAVE_APPROVER_ROLES,
  LEAVE_REQUEST_VIEW_ROLES,
  LEAVE_SELF_SERVICE_ROLES,
  LEAVE_TYPE_MANAGER_ROLES,
  type AppRole
} from "../constants/roles";
import { buildHolidayConflictFilter, ensureHolidayIndexes, normalizeHolidayScope } from "../utils/holidayScope";

type LeaveWorkflowType = "single_level" | "multi_level";
type ApprovalFlowStep = { level: number; role: AppRole };
type ApprovalFlowViewStatus = "WAITING" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type LeaveStatusBucket = { _id: string; count: number };
type AuthenticatedRequest = Request & {
  user?: { id: string; role: AppRole };
  file?: Express.Multer.File;
};
type LeaveAttachmentFile = Pick<
  Express.Multer.File,
  "originalname" | "filename" | "mimetype" | "size" | "path"
>;
type PopulatedUserRef = mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId | string; name?: string; email?: string };
type PopulatedLeaveTypeRef = mongoose.Types.ObjectId | { _id?: mongoose.Types.ObjectId | string; name?: string; code?: string; color?: string };
type LeaveApprovalHistoryEntry = LeaveRequestModel["approvalHistory"][number] & {
  by?: PopulatedUserRef | null;
};
type LeaveWorkflowSource = {
  approvalWorkflowType?: string | null;
  approvalFlowSteps?: Array<{ level?: number | null; role?: string | null }> | null;
  status?: string | null;
  currentApprovalLevel?: number | null;
  fromDate?: Date;
};
type LeaveTypePayloadSource = Pick<
  LeaveTypeModel,
  | "name"
  | "code"
  | "description"
  | "color"
  | "totalAllocation"
  | "allocationPeriod"
  | "carryForwardEnabled"
  | "maxCarryForwardLimit"
  | "accrualEnabled"
  | "accrualAmount"
  | "accrualFrequency"
  | "maxDaysPerRequest"
  | "minNoticeDays"
  | "allowPastDates"
  | "requiresAttachment"
  | "status"
  | "createdAt"
  | "updatedAt"
> &
  LeaveWorkflowSource & {
    _id: mongoose.Types.ObjectId | string;
  };
type LeaveRequestPayloadSource = Pick<
  LeaveRequestModel,
  | "fromDate"
  | "toDate"
  | "dayUnit"
  | "totalDays"
  | "reason"
  | "attachment"
  | "status"
  | "currentApprovalLevel"
  | "balanceCycleKey"
  | "createdAt"
  | "updatedAt"
  | "cancelledAt"
  | "rejectionReason"
  | "leaveTypeSnapshot"
> &
  LeaveWorkflowSource & {
    _id: mongoose.Types.ObjectId | string;
    employeeId?: PopulatedUserRef | null;
    leaveTypeId?: PopulatedLeaveTypeRef | null;
    approvalHistory?: LeaveApprovalHistoryEntry[] | null;
  };
type LeaveSummaryCounts = {
  totalRequests: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled?: number;
};

function getPopulatedUserId(value: PopulatedUserRef | null | undefined) {
  if (!value) return null;
  if (typeof value === "object" && "_id" in value && value._id != null) {
    return value._id;
  }
  return value;
}

function getPopulatedUserName(value: PopulatedUserRef | null | undefined) {
  return typeof value === "object" && value && "name" in value ? value.name ?? "" : "";
}

function getPopulatedUserEmail(value: PopulatedUserRef | null | undefined) {
  return typeof value === "object" && value && "email" in value ? value.email ?? "" : "";
}

function getPopulatedLeaveTypeId(value: PopulatedLeaveTypeRef | null | undefined) {
  if (!value) return null;
  if (typeof value === "object" && "_id" in value && value._id != null) {
    return value._id;
  }
  return value;
}

function getPopulatedLeaveTypeName(value: PopulatedLeaveTypeRef | null | undefined) {
  return typeof value === "object" && value && "name" in value ? value.name ?? "" : "";
}

function getPopulatedLeaveTypeCode(value: PopulatedLeaveTypeRef | null | undefined) {
  return typeof value === "object" && value && "code" in value ? value.code ?? "" : "";
}

function getPopulatedLeaveTypeColor(value: PopulatedLeaveTypeRef | null | undefined) {
  return typeof value === "object" && value && "color" in value ? value.color ?? "" : "";
}

function getAuthUser(req: Request) {
  return (req as AuthenticatedRequest).user as { id: string; role: AppRole };
}

function canManageLeaveTypes(role?: string) {
  return hasAnyRole(role, LEAVE_TYPE_MANAGER_ROLES);
}

function canViewLeaveRequests(role?: string) {
  return hasAnyRole(role, LEAVE_REQUEST_VIEW_ROLES);
}

function canTakeLeaveAction(role?: string) {
  return hasAnyRole(role, LEAVE_APPROVER_ROLES);
}

async function getTeamLeaderScopedEmployeeIds(userId: string) {
  return getTeamMemberIdsByLeader(userId);
}

async function canTeamLeaderAccessLeaveRequest(
  authUser: { id: string; role: AppRole },
  requestDoc: {
    employeeId?: PopulatedUserRef | null;
    approvalHistory?: LeaveApprovalHistoryEntry[] | null;
  } & LeaveWorkflowSource
) {
  if (authUser.role !== "teamLeader") {
    return true;
  }

  const scopedEmployeeIds = await getTeamLeaderScopedEmployeeIds(authUser.id);
  const requestEmployeeId = String(getPopulatedUserId(requestDoc.employeeId) ?? "");

  if (!requestEmployeeId || !scopedEmployeeIds.includes(requestEmployeeId)) {
    return false;
  }

  const nextApprovalRole = getNextApproverRole(requestDoc);
  const actedByCurrentLeader = (requestDoc.approvalHistory || []).some(
    (historyItem) => String(getPopulatedUserId(historyItem.by) ?? "") === authUser.id
  );

  return nextApprovalRole === "teamLeader" || actedByCurrentLeader;
}

async function safelyDeleteUploadedFile(file?: { path?: string }) {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch {
    // ignore cleanup failures
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeAttachment(file?: LeaveAttachmentFile | null) {
  if (!file) return null;
  return {
    originalName: file.originalname,
    fileName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    url: getLeaveAttachmentPublicUrl(file.filename)
  };
}

function normalizeApprovalWorkflowType(value?: string | null): LeaveWorkflowType {
  return value === "single_level" ? "single_level" : "multi_level";
}

export function resolveNextLeaveRequestStatus(isFinalApproval: boolean) {
  return isFinalApproval ? "Approved" : "Level 1 Approved";
}

export function summarizeLeaveStatusBuckets(
  buckets: LeaveStatusBucket[],
  includeCancelled = false
): LeaveSummaryCounts {
  const counts: LeaveSummaryCounts = {
    totalRequests: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    ...(includeCancelled ? { cancelled: 0 } : {})
  };

  for (const item of buckets) {
    counts.totalRequests += item.count;
    if (item._id === "Pending" || item._id === "Level 1 Approved") counts.pending += item.count;
    if (item._id === "Approved") counts.approved += item.count;
    if (item._id === "Rejected") counts.rejected += item.count;
    if (includeCancelled && item._id === "Cancelled" && typeof counts.cancelled === "number") {
      counts.cancelled += item.count;
    }
  }

  return counts;
}

function normalizeApprovalFlowSteps(
  workflowType: string | null | undefined,
  steps: Array<{ level?: number | null; role?: string | null }> | null | undefined
): ApprovalFlowStep[] {
  const validRoles = new Set<AppRole>(LEAVE_APPROVER_ROLES);
  const normalizedWorkflowType = normalizeApprovalWorkflowType(workflowType);
  const validSteps = (steps || [])
    .filter((item): item is { level?: number | null; role: AppRole } => !!item?.role && validRoles.has(item.role as AppRole))
    .sort((left, right) => (left.level ?? 0) - (right.level ?? 0))
    .map((item, index) => ({
      level: index + 1,
      role: item.role
    }));

  if (normalizedWorkflowType === "single_level") {
    return [
      {
        level: 1,
        role: validSteps[0]?.role ?? "admin"
      }
    ];
  }

  if (validSteps.length >= 2) {
    return validSteps;
  }

  return [
    { level: 1, role: "admin" },
    { level: 2, role: "superadmin" }
  ];
}

function resolveRequestWorkflow(doc: LeaveWorkflowSource, leaveType?: LeaveWorkflowSource) {
  const workflowType = normalizeApprovalWorkflowType(doc?.approvalWorkflowType ?? leaveType?.approvalWorkflowType);
  const approvalFlowSteps = normalizeApprovalFlowSteps(
    doc?.approvalWorkflowType ?? leaveType?.approvalWorkflowType,
    doc?.approvalFlowSteps ?? leaveType?.approvalFlowSteps
  );

  return {
    approvalWorkflowType: workflowType,
    approvalFlowSteps
  };
}

function getNextApproverRole(doc: LeaveWorkflowSource, leaveType?: LeaveWorkflowSource) {
  const { approvalFlowSteps } = resolveRequestWorkflow(doc, leaveType);
  if (!["Pending", "Level 1 Approved"].includes(doc?.status ?? "")) {
    return null;
  }

  const nextStep = approvalFlowSteps[Math.max(0, doc?.currentApprovalLevel || 0)];
  return nextStep?.role ?? null;
}

function getCurrentActionLevel(doc: LeaveWorkflowSource, leaveType?: LeaveWorkflowSource) {
  const { approvalFlowSteps } = resolveRequestWorkflow(doc, leaveType);

  if (["Pending", "Level 1 Approved"].includes(doc?.status ?? "")) {
    return approvalFlowSteps[Math.max(0, doc?.currentApprovalLevel || 0)]?.level ?? 1;
  }

  return approvalFlowSteps[approvalFlowSteps.length - 1]?.level ?? 1;
}

function getRoleAwareLeaveActions(doc: LeaveWorkflowSource, authRole?: AppRole, leaveType?: LeaveWorkflowSource) {
  if (!doc.fromDate) {
    return [];
  }

  const baseActions = getAllowedLeaveActions(doc?.status ?? "", doc.fromDate);
  if (!baseActions.length || !authRole) {
    return [];
  }

  const { approvalFlowSteps } = resolveRequestWorkflow(doc, leaveType);
  const requiredRole =
    ["Pending", "Level 1 Approved"].includes(doc?.status ?? "")
      ? approvalFlowSteps[Math.max(0, doc?.currentApprovalLevel || 0)]?.role
      : approvalFlowSteps[approvalFlowSteps.length - 1]?.role;

  return requiredRole === authRole ? baseActions : [];
}

function buildApprovalFlowView(doc: LeaveRequestPayloadSource, authRole?: AppRole) {
  const workflow = resolveRequestWorkflow(doc);
  const nextApprovalRole = getNextApproverRole(doc);
  const canActOnCurrentStep = getRoleAwareLeaveActions(doc, authRole).length > 0;

  return workflow.approvalFlowSteps.map((step) => {
    const rejectedEntry = (doc.approvalHistory || []).find(
      (item) => item.level === step.level && item.action === "Rejected"
    );
    const approvedEntry = (doc.approvalHistory || []).find(
      (item) => item.level === step.level && item.action === "Approved"
    );

    let status: ApprovalFlowViewStatus = "WAITING";
    if (rejectedEntry) {
      status = "REJECTED";
    } else if (approvedEntry) {
      status = "APPROVED";
    } else if (doc.status === "Cancelled") {
      status = "CANCELLED";
    } else if (nextApprovalRole === step.role && ["Pending", "Level 1 Approved"].includes(doc.status)) {
      status = "PENDING";
    }

    return {
      level: step.level,
      role: step.role,
      status,
      canAct: status === "PENDING" && canActOnCurrentStep && authRole === step.role,
      actedAt: rejectedEntry?.actedAt ?? approvedEntry?.actedAt ?? null,
      remarks: rejectedEntry?.remarks ?? approvedEntry?.remarks ?? "",
      actedBy:
        rejectedEntry?.by || approvedEntry?.by
          ? {
              id: getPopulatedUserId(rejectedEntry?.by ?? approvedEntry?.by),
              name: getPopulatedUserName(rejectedEntry?.by ?? approvedEntry?.by),
              email: getPopulatedUserEmail(rejectedEntry?.by ?? approvedEntry?.by)
            }
          : null
    };
  });
}

function buildRequestApprovalFlowForApplicant(leaveType: LeaveWorkflowSource, applicantRole: AppRole) {
  const workflow = resolveRequestWorkflow(leaveType, leaveType);
  let steps = workflow.approvalFlowSteps;

  if (applicantRole === "teamLeader") {
    steps = steps.filter((step) => step.role !== "teamLeader");
  }

  if (applicantRole === "HR" || applicantRole === "admin") {
    steps = steps.filter((step) => step.role === "superadmin");
  }

  if (steps.length === 0) {
    if (applicantRole === "teamLeader") {
      steps = [{ level: 1, role: "admin" }];
    } else if (applicantRole === "HR" || applicantRole === "admin") {
      steps = [{ level: 1, role: "superadmin" }];
    } else {
      steps = workflow.approvalFlowSteps;
    }
  }

  const approvalFlowSteps = steps.map((step, index) => ({
    level: index + 1,
    role: step.role
  }));

  return {
    approvalWorkflowType: approvalFlowSteps.length <= 1 ? "single_level" : ("multi_level" as LeaveWorkflowType),
    approvalFlowSteps
  };
}

function buildLeaveTypePayload(doc: LeaveTypePayloadSource) {
  const workflow = resolveRequestWorkflow(doc);
  return {
    id: doc._id,
    name: doc.name,
    code: doc.code,
    description: doc.description,
    color: doc.color,
    totalAllocation: doc.totalAllocation,
    allocationPeriod: doc.allocationPeriod,
    carryForwardEnabled: doc.carryForwardEnabled,
    maxCarryForwardLimit: doc.maxCarryForwardLimit,
    accrualEnabled: doc.accrualEnabled,
    accrualAmount: doc.accrualAmount,
    accrualFrequency: doc.accrualFrequency,
    approvalWorkflowType: workflow.approvalWorkflowType,
    approvalFlowSteps: workflow.approvalFlowSteps,
    maxDaysPerRequest: doc.maxDaysPerRequest,
    minNoticeDays: doc.minNoticeDays,
    allowPastDates: doc.allowPastDates,
    requiresAttachment: doc.requiresAttachment,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function buildLeaveRequestPayload(
  doc: LeaveRequestPayloadSource,
  authUser?: { role?: AppRole; id?: string }
) {
  const workflow = resolveRequestWorkflow(doc);
  const approvalFlow = buildApprovalFlowView(doc, authUser?.role);
  const currentApprovalStep = approvalFlow.find((step) => step.status === "PENDING") || null;
  const employeeId = getPopulatedUserId(doc.employeeId);

  return {
    id: doc._id,
    employee: doc.employeeId
      ? {
          id: getPopulatedUserId(doc.employeeId),
          name: getPopulatedUserName(doc.employeeId),
          email: getPopulatedUserEmail(doc.employeeId)
        }
      : null,
    leaveType: {
      id: getPopulatedLeaveTypeId(doc.leaveTypeId),
      name: doc.leaveTypeSnapshot?.name ?? getPopulatedLeaveTypeName(doc.leaveTypeId) ?? "",
      code: doc.leaveTypeSnapshot?.code ?? getPopulatedLeaveTypeCode(doc.leaveTypeId) ?? "",
      color: doc.leaveTypeSnapshot?.color ?? getPopulatedLeaveTypeColor(doc.leaveTypeId) ?? "#2563eb"
    },
    fromDate: doc.fromDate,
    toDate: doc.toDate,
    dayUnit: doc.dayUnit,
    totalDays: doc.totalDays,
    reason: doc.reason,
    attachment: doc.attachment
      ? {
          originalName: doc.attachment.originalName,
          url: doc.attachment.url,
          mimeType: doc.attachment.mimeType,
          size: doc.attachment.size
        }
      : null,
    status: doc.status,
    allowedActions: getRoleAwareLeaveActions(doc, authUser?.role),
    canCancel:
      !!authUser?.id &&
      String(employeeId ?? "") === String(authUser.id) &&
      canCancelLeaveRequest(doc.status, doc.fromDate),
    currentApprovalLevel: doc.currentApprovalLevel,
    approvalWorkflowType: workflow.approvalWorkflowType,
    approvalFlowSteps: workflow.approvalFlowSteps,
    approvalFlow,
    nextApprovalRole: getNextApproverRole(doc),
    currentApproverRole: currentApprovalStep?.role ?? null,
    currentApproverLabel: currentApprovalStep ? `Pending from ${currentApprovalStep.role}` : "Finalized",
    balanceCycleKey: doc.balanceCycleKey,
    approvalHistory: (doc.approvalHistory || []).map((item) => ({
      level: item.level,
      action: item.action,
      role: item.role,
      remarks: item.remarks,
      actedAt: item.actedAt,
      by: item.by
        ? {
            id: getPopulatedUserId(item.by),
            name: getPopulatedUserName(item.by),
            email: getPopulatedUserEmail(item.by)
          }
        : null
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    cancelledAt: doc.cancelledAt ?? null,
    rejectionReason: doc.rejectionReason ?? ""
  };
}

async function notifyLeaveStatusChange(params: {
  employeeId: string;
  leaveRequestId: string;
  leaveTypeName: string;
  status: "Approved" | "Rejected";
  fromDate: Date;
  toDate: Date;
}) {
  await upsertAppNotifications([
    {
      userId: params.employeeId,
      title: `Leave ${params.status}`,
      message: `${params.leaveTypeName} leave for ${toYmd(params.fromDate)} to ${toYmd(params.toDate)} was ${params.status.toLowerCase()}.`,
      type: "leave_status",
      link: "/leaves/my",
      entityType: "leave_request",
      entityId: params.leaveRequestId,
      dedupeKey: `leave:${params.leaveRequestId}:status:${params.status.toLowerCase()}`
    }
  ]);
}

export const listLeaveTypes = async (_req: Request, res: Response) => {
  try {
    const parsed = leaveTypeListQuerySchema.safeParse(_req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid leave type filters" });
    }

    const filter: Record<string, unknown> = { isDeleted: false };
    if (parsed.data.status !== "all") filter.status = parsed.data.status;
    if (parsed.data.workflow !== "all") filter.approvalWorkflowType = parsed.data.workflow;
    if (parsed.data.search) {
      filter.$or = [
        { name: { $regex: parsed.data.search, $options: "i" } },
        { code: { $regex: parsed.data.search, $options: "i" } }
      ];
    }

    const leaveTypes = await LeaveType.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      data: { items: leaveTypes.map(buildLeaveTypePayload) }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave types" });
  }
};

export const getActiveLeaveTypes = async (_req: Request, res: Response) => {
  try {
    const leaveTypes = await LeaveType.find({
      isDeleted: false,
      status: "Active"
    })
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: { items: leaveTypes.map(buildLeaveTypePayload) }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave types" });
  }
};

export const createLeaveType = async (req: Request, res: Response) => {
  try {
    const parsed = leaveTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const payload = {
      ...parsed.data,
      code: parsed.data.code.toUpperCase(),
      approvalWorkflowType: normalizeApprovalWorkflowType(parsed.data.approvalWorkflowType),
      approvalFlowSteps: normalizeApprovalFlowSteps(parsed.data.approvalWorkflowType, parsed.data.approvalFlowSteps),
      createdBy: authUser.id
    };

    const [existingName, existingCode] = await Promise.all([
      LeaveType.findOne({
        isDeleted: false,
        name: { $regex: new RegExp(`^${payload.name}$`, "i") }
      }).lean(),
      LeaveType.findOne({
        isDeleted: false,
        code: payload.code
      }).lean()
    ]);

    if (existingName) {
      return res.status(400).json({ success: false, message: "Leave type name already exists" });
    }

    if (existingCode) {
      return res.status(400).json({ success: false, message: "Leave type code already exists" });
    }

    const created = await LeaveType.create(payload);
    return res.status(201).json({
      success: true,
      message: "Leave type created successfully",
      data: buildLeaveTypePayload(created)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create leave type" });
  }
};

export const updateLeaveType = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid leave type id" });
    }

    const parsed = leaveTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const payload = {
      ...parsed.data,
      code: parsed.data.code.toUpperCase(),
      approvalWorkflowType: normalizeApprovalWorkflowType(parsed.data.approvalWorkflowType),
      approvalFlowSteps: normalizeApprovalFlowSteps(parsed.data.approvalWorkflowType, parsed.data.approvalFlowSteps),
      updatedBy: authUser.id
    };

    const [existingName, existingCode] = await Promise.all([
      LeaveType.findOne({
        _id: { $ne: parsedParam.data.id },
        isDeleted: false,
        name: { $regex: new RegExp(`^${payload.name}$`, "i") }
      }).lean(),
      LeaveType.findOne({
        _id: { $ne: parsedParam.data.id },
        isDeleted: false,
        code: payload.code
      }).lean()
    ]);

    if (existingName) {
      return res.status(400).json({ success: false, message: "Leave type name already exists" });
    }

    if (existingCode) {
      return res.status(400).json({ success: false, message: "Leave type code already exists" });
    }

    const updated = await LeaveType.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      payload,
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Leave type not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave type updated successfully",
      data: buildLeaveTypePayload(updated)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update leave type" });
  }
};

export const deleteLeaveType = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid leave type id" });
    }

    const authUser = getAuthUser(req);
    const deleted = await LeaveType.findOneAndUpdate(
      { _id: parsedParam.data.id, isDeleted: false },
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: authUser.id,
        updatedBy: authUser.id
      },
      { returnDocument: "after" }
    ).lean();

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Leave type not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Leave type deleted successfully"
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete leave type" });
  }
};

export const applyLeave = async (req: Request, res: Response) => {
  const authUser = getAuthUser(req);
  const file = (req as AuthenticatedRequest).file;

  try {
    if (!hasAnyRole(authUser.role, LEAVE_SELF_SERVICE_ROLES)) {
      await safelyDeleteUploadedFile(file);
      return res.status(403).json({ success: false, message: "This role cannot apply for leave" });
    }

    const parsed = leaveApplySchema.safeParse(req.body);
    if (!parsed.success) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const employee = await validateEmployeeAccess(authUser.id);
    if (!employee) {
      await safelyDeleteUploadedFile(file);
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const leaveType = await LeaveType.findOne({
      _id: parsed.data.leaveTypeId,
      isDeleted: false,
      status: "Active"
    }).lean();

    if (!leaveType) {
      await safelyDeleteUploadedFile(file);
      return res.status(404).json({ success: false, message: "Leave type not found or inactive" });
    }

    const fromDate = startOfDay(parsed.data.fromDate);
    const toDate = startOfDay(parsed.data.toDate);

    if (parsed.data.dayUnit === "HALF" && fromDate.getTime() !== toDate.getTime()) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: "Half-day leave can only be applied for a single day"
      });
    }

    if (!leaveType.allowPastDates && fromDate < startOfDay(new Date())) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({ success: false, message: "Past date leave application is not allowed" });
    }

    const daysBeforeApply = Math.floor(
      (fromDate.getTime() - startOfDay(new Date()).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysBeforeApply < leaveType.minNoticeDays) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: `Minimum ${leaveType.minNoticeDays} notice day(s) required`
      });
    }

    if (leaveType.allocationPeriod === "monthly" && fromDate.getMonth() !== toDate.getMonth()) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: "Monthly leave types must be applied within the same month"
      });
    }

    const holidayDateKeys = await getHolidayDateKeysInRange(
      fromDate,
      toDate,
      employee.department ? String(employee.department) : null
    );
    const totalDays = calculateLeaveDays(fromDate, toDate, parsed.data.dayUnit, holidayDateKeys);

    if (totalDays <= 0) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: "Selected dates fall only on weekends or holidays"
      });
    }

    if (totalDays > leaveType.maxDaysPerRequest) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: `This leave type allows maximum ${leaveType.maxDaysPerRequest} day(s) per request`
      });
    }

    if (leaveType.requiresAttachment && !file) {
      return res.status(400).json({
        success: false,
        message: "Attachment is required for this leave type"
      });
    }

    const noOverlap = await ensureNoOverlap({
      employeeId: authUser.id,
      fromDate,
      toDate
    });

    if (!noOverlap) {
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({
        success: false,
        message: "You have already applied for leave on the selected date(s). Please choose different dates."
      });
    }

    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const balance = await ensureLeaveBalance({
        employeeId: authUser.id,
        leaveType,
        cycleDate: fromDate,
        session
      });

      const balanceSummary = buildBalanceSummary(balance);
      if (balanceSummary.remaining < totalDays) {
        throw new Error("Insufficient leave balance for this request");
      }

      balance.pending = Number((balance.pending + totalDays).toFixed(2));
      await balance.save({ session });

      const requestWorkflow = buildRequestApprovalFlowForApplicant(leaveType, authUser.role);

      const created = await LeaveRequest.create(
        [
          {
            approvalWorkflowType: requestWorkflow.approvalWorkflowType,
            approvalFlowSteps: requestWorkflow.approvalFlowSteps,
            employeeId: authUser.id,
            leaveTypeId: leaveType._id,
            leaveTypeSnapshot: {
              name: leaveType.name,
              code: leaveType.code,
              color: leaveType.color
            },
            fromDate,
            toDate,
            dayUnit: parsed.data.dayUnit,
            totalDays,
            reason: parsed.data.reason,
            attachment: normalizeAttachment(file),
            status: "Pending",
            currentApprovalLevel: 0,
            balanceCycleKey: balance.cycleKey,
            approvalHistory: [
              {
                level: 0,
                action: "Submitted",
                by: authUser.id,
                role: authUser.role,
                remarks: "",
                actedAt: new Date()
              }
            ]
          }
        ],
        { session }
      );

      await session.commitTransaction();
      return res.status(201).json({
        success: true,
        message: "Leave applied successfully",
        data: { id: created[0]._id }
      });
    } catch (error: unknown) {
      await session.abortTransaction();
      await safelyDeleteUploadedFile(file);
      return res.status(400).json({ success: false, message: getErrorMessage(error, "Failed to apply leave") });
    } finally {
      session.endSession();
    }
  } catch {
    await safelyDeleteUploadedFile(file);
    return res.status(500).json({ success: false, message: "Failed to apply leave" });
  }
};

export const getMyLeaveBalances = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    const activeTypes = await LeaveType.find({
      isDeleted: false,
      status: "Active"
    }).lean();

    const items = [];
    for (const leaveType of activeTypes) {
      try {
        const balance = await ensureLeaveBalance({
          employeeId: authUser.id,
          leaveType,
          cycleDate: new Date()
        });

        items.push({
          leaveType: buildLeaveTypePayload(leaveType),
          cycleKey: balance.cycleKey,
          year: balance.year,
          month: balance.month,
          ...buildBalanceSummary(balance.toObject())
        });
      } catch {
        const cycle = getCycleParts(new Date(), leaveType.allocationPeriod);
        items.push({
          leaveType: buildLeaveTypePayload(leaveType),
          cycleKey: cycle.cycleKey,
          year: cycle.year,
          month: cycle.month,
          ...buildBalanceSummary({
            totalAllocated: leaveType.totalAllocation,
            accrued: 0,
            carriedForward: 0,
            used: 0,
            pending: 0
          })
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: { items }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave balances" });
  }
};

export const getLeaveBalances = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!canManageLeaveTypes(authUser.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const parsed = leaveBalanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid query parameters" });
    }

    const filter: Record<string, unknown> = {};
    if (parsed.data.employeeId) filter.employeeId = parsed.data.employeeId;
    if (parsed.data.year) filter.year = parsed.data.year;
    if (parsed.data.month) filter.month = parsed.data.month;

    const balances = await LeaveBalance.find(filter)
      .populate("employeeId", "name email")
      .populate("leaveTypeId", "name code color")
      .sort({ year: -1, month: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        items: balances.map((balance) => ({
          id: balance._id,
          employee: balance.employeeId
            ? {
                id: getPopulatedUserId(balance.employeeId),
                name: getPopulatedUserName(balance.employeeId),
                email: getPopulatedUserEmail(balance.employeeId)
              }
            : null,
          leaveType: balance.leaveTypeId
            ? {
                id: getPopulatedLeaveTypeId(balance.leaveTypeId),
                name: getPopulatedLeaveTypeName(balance.leaveTypeId),
                code: getPopulatedLeaveTypeCode(balance.leaveTypeId),
                color: getPopulatedLeaveTypeColor(balance.leaveTypeId)
              }
            : null,
          cycleKey: balance.cycleKey,
          year: balance.year,
          month: balance.month,
          ...buildBalanceSummary(balance)
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch balances" });
  }
};

export const getLeaveEmployees = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!canViewLeaveRequests(authUser.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const filter: Record<string, unknown> = {
      role: { $in: LEAVE_SELF_SERVICE_ROLES },
      status: "Active",
      isDeleted: false
    };

    if (authUser.role === "teamLeader") {
      const scopedEmployeeIds = await getTeamLeaderScopedEmployeeIds(authUser.id);
      filter._id = { $in: scopedEmployeeIds };
    }

    const employees = await User.find(filter)
      .select("_id name email")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        items: employees.map((item) => ({
          id: item._id,
          name: item.name,
          email: item.email
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch employees" });
  }
};

export const getMyLeaveRequests = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    const parsed = leaveListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid query parameters" });
    }

    const page = parsed.data.page;
    const limit = parsed.data.limit;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { employeeId: authUser.id };
    if (parsed.data.status !== "all") filter.status = parsed.data.status;
    if (parsed.data.leaveTypeId) filter.leaveTypeId = parsed.data.leaveTypeId;
    if (parsed.data.fromDate) {
      filter.fromDate = { ...(filter.fromDate || {}), $gte: startOfDay(new Date(parsed.data.fromDate)) };
    }
    if (parsed.data.toDate) {
      filter.toDate = { ...(filter.toDate || {}), $lte: startOfDay(new Date(parsed.data.toDate)) };
    }

    const [total, requests] = await Promise.all([
      LeaveRequest.countDocuments(filter),
      LeaveRequest.find(filter)
        .populate("employeeId", "name email")
        .populate("leaveTypeId", "name code color")
        .populate("approvalHistory.by", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: requests.map((item) => buildLeaveRequestPayload(item, authUser)),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave requests" });
  }
};

export const getLeaveRequests = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    if (!canViewLeaveRequests(authUser.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const parsed = leaveListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid query parameters" });
    }

    const page = parsed.data.page;
    const limit = parsed.data.limit;

    const filter: Record<string, unknown> = {};
    if (parsed.data.status !== "all") filter.status = parsed.data.status;
    if (parsed.data.leaveTypeId) filter.leaveTypeId = parsed.data.leaveTypeId;
    if (parsed.data.employeeId) filter.employeeId = parsed.data.employeeId;
    if (parsed.data.fromDate) {
      filter.fromDate = { ...(filter.fromDate || {}), $gte: startOfDay(new Date(parsed.data.fromDate)) };
    }
    if (parsed.data.toDate) {
      filter.toDate = { ...(filter.toDate || {}), $lte: startOfDay(new Date(parsed.data.toDate)) };
    }
    if (parsed.data.search) {
      const employeeIds = await User.find({
        isDeleted: false,
        $or: [
          { name: { $regex: parsed.data.search, $options: "i" } },
          { email: { $regex: parsed.data.search, $options: "i" } }
        ]
      })
        .select("_id")
        .lean();

      filter.$or = [
        { reason: { $regex: parsed.data.search, $options: "i" } },
        { "leaveTypeSnapshot.name": { $regex: parsed.data.search, $options: "i" } },
        { employeeId: { $in: employeeIds.map((item) => item._id) } }
      ];
    }

    const isTeamLeaderView = authUser.role === "teamLeader";
    if (isTeamLeaderView) {
      const scopedEmployeeIds = await getTeamLeaderScopedEmployeeIds(authUser.id);

      if (scopedEmployeeIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            items: [],
            total: 0,
            page,
            limit,
            totalPages: 0
          }
        });
      }

      if (parsed.data.employeeId) {
        if (!scopedEmployeeIds.includes(parsed.data.employeeId)) {
          return res.status(200).json({
            success: true,
            data: {
              items: [],
              total: 0,
              page,
              limit,
              totalPages: 0
            }
          });
        }
      } else {
        filter.employeeId = { $in: scopedEmployeeIds };
      }
    }

    const baseQuery = LeaveRequest.find(filter)
      .populate("employeeId", "name email")
      .populate("leaveTypeId", "name code color")
      .populate("approvalHistory.by", "name email")
      .sort({ createdAt: -1 });

    const requests = isTeamLeaderView
      ? await baseQuery.lean()
      : await baseQuery.skip((page - 1) * limit).limit(limit).lean();

    const filteredRequests = isTeamLeaderView
      ? requests.filter((item) => {
          const nextApprovalRole = getNextApproverRole(item);
          const actedByCurrentLeader = (item.approvalHistory || []).some(
            (historyItem) => String(historyItem.by?._id ?? historyItem.by) === authUser.id
          );
          return nextApprovalRole === "teamLeader" || actedByCurrentLeader;
        })
      : requests;

    const total = isTeamLeaderView ? filteredRequests.length : await LeaveRequest.countDocuments(filter);
    const pagedRequests = isTeamLeaderView
      ? filteredRequests.slice((page - 1) * limit, (page - 1) * limit + limit)
      : filteredRequests;

    return res.status(200).json({
      success: true,
      data: {
        items: pagedRequests.map((item) => buildLeaveRequestPayload(item, authUser)),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave requests" });
  }
};

export const getLeaveRequestById = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid leave request id" });
    }

    const requestDoc = await LeaveRequest.findById(parsed.data.id)
      .populate("employeeId", "name email")
      .populate("leaveTypeId", "name code color")
      .populate("approvalHistory.by", "name email")
      .lean();

    if (!requestDoc) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    const isOwnRequest = String(requestDoc.employeeId?._id ?? requestDoc.employeeId) === authUser.id;

    if (authUser.role === "employee" && !isOwnRequest) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (authUser.role === "teamLeader" && !(await canTeamLeaderAccessLeaveRequest(authUser, requestDoc))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return res.status(200).json({
      success: true,
      data: buildLeaveRequestPayload(requestDoc, authUser)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave request" });
  }
};

export const takeLeaveAction = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (!canTakeLeaveAction(authUser.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid leave request id" });
    }

    const parsedBody = leaveActionSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsedBody.error)
      });
    }

    const requestDoc = await LeaveRequest.findById(parsedParam.data.id);
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    if (!(await canTeamLeaderAccessLeaveRequest(authUser, requestDoc.toObject()))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (hasLeaveDatePassed(requestDoc.fromDate)) {
      return res.status(400).json({
        success: false,
        message: "Leave status cannot be changed after the leave start date"
      });
    }

    const leaveType = await LeaveType.findById(requestDoc.leaveTypeId).lean();
    if (!leaveType) {
      return res.status(404).json({ success: false, message: "Leave type not found" });
    }

    const previousStatus = requestDoc.status;
    const allowedActions = getAllowedLeaveActions(previousStatus, requestDoc.fromDate);
    if (!allowedActions.includes(parsedBody.data.action)) {
      return res.status(400).json({
        success: false,
        message: "This leave status cannot be changed with the requested action"
      });
    }

    const requestWorkflow = resolveRequestWorkflow(requestDoc, leaveType);
    const finalApprovalLevel = requestWorkflow.approvalFlowSteps.length;
    const currentActionLevel = getCurrentActionLevel(requestDoc, leaveType);
    const requiredRole =
      ["Pending", "Level 1 Approved"].includes(previousStatus)
        ? requestWorkflow.approvalFlowSteps[Math.max(0, requestDoc.currentApprovalLevel || 0)]?.role
        : requestWorkflow.approvalFlowSteps[requestWorkflow.approvalFlowSteps.length - 1]?.role;

    if (requiredRole && authUser.role !== requiredRole) {
      return res.status(403).json({
        success: false,
        message: `This request is currently assigned to ${requiredRole}`
      });
    }

    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const balance = await LeaveBalance.findOne({
        employeeId: requestDoc.employeeId,
        leaveTypeId: requestDoc.leaveTypeId,
        cycleKey: requestDoc.balanceCycleKey
      }).session(session);

      if (!balance) {
        throw new Error("Leave balance record not found");
      }

      if (parsedBody.data.action === "reject") {
        balance.pending = Math.max(0, Number((balance.pending - requestDoc.totalDays).toFixed(2)));

        requestDoc.status = "Rejected";
        requestDoc.currentApprovalLevel = 0;
        requestDoc.rejectionReason = parsedBody.data.remarks || "";
        requestDoc.approvalHistory.push({
          level: currentActionLevel,
          action: "Rejected",
          by: new mongoose.Types.ObjectId(authUser.id),
          role: authUser.role,
          remarks: parsedBody.data.remarks || "",
          actedAt: new Date()
        });

        await Promise.all([balance.save({ session }), requestDoc.save({ session })]);
        await session.commitTransaction();
        await notifyLeaveStatusChange({
          employeeId: String(requestDoc.employeeId),
          leaveRequestId: String(requestDoc._id),
          leaveTypeName: requestDoc.leaveTypeSnapshot?.name ?? leaveType.name,
          status: "Rejected",
          fromDate: requestDoc.fromDate,
          toDate: requestDoc.toDate
        });
        await recordAuditLog({
          actorId: authUser.id,
          actorRole: authUser.role,
          action: "leave.reject",
          entityType: "leave_request",
          entityId: String(requestDoc._id),
          summary: `Rejected leave request ${requestDoc._id}`,
          metadata: { level: currentActionLevel }
        });
        return res.status(200).json({ success: true, message: "Leave request rejected successfully" });
      }

      const isFinalApproval = currentActionLevel >= finalApprovalLevel;

      if (isFinalApproval) {
        balance.pending = Math.max(0, Number((balance.pending - requestDoc.totalDays).toFixed(2)));
        balance.used = Number((balance.used + requestDoc.totalDays).toFixed(2));
      }

      requestDoc.status = resolveNextLeaveRequestStatus(isFinalApproval);
      requestDoc.currentApprovalLevel = isFinalApproval ? finalApprovalLevel : currentActionLevel;
      requestDoc.rejectionReason = "";

      requestDoc.approvalHistory.push({
        level: currentActionLevel,
        action: "Approved",
        by: new mongoose.Types.ObjectId(authUser.id),
        role: authUser.role,
        remarks: parsedBody.data.remarks || "",
        actedAt: new Date()
      });

      await Promise.all([balance.save({ session }), requestDoc.save({ session })]);
      await session.commitTransaction();
      if (isFinalApproval) {
        await notifyLeaveStatusChange({
          employeeId: String(requestDoc.employeeId),
          leaveRequestId: String(requestDoc._id),
          leaveTypeName: requestDoc.leaveTypeSnapshot?.name ?? leaveType.name,
          status: "Approved",
          fromDate: requestDoc.fromDate,
          toDate: requestDoc.toDate
        });
      }
      await recordAuditLog({
        actorId: authUser.id,
        actorRole: authUser.role,
        action: isFinalApproval ? "leave.approve" : "leave.forward",
        entityType: "leave_request",
        entityId: String(requestDoc._id),
        summary: isFinalApproval
          ? `Approved leave request ${requestDoc._id}`
          : `Forwarded leave request ${requestDoc._id} to next approval level`,
        metadata: { level: currentActionLevel }
      });

      return res.status(200).json({
        success: true,
        message: isFinalApproval ? "Leave request approved successfully" : "Leave request forwarded to the next approval level"
      });
    } catch (error: unknown) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: getErrorMessage(error, "Failed to update leave request") });
    } finally {
      session.endSession();
    }
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update leave request" });
  }
};

export const cancelMyLeaveRequest = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid leave request id" });
    }

    const parsedBody = leaveCancelSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsedBody.error)
      });
    }

    const requestDoc = await LeaveRequest.findById(parsedParam.data.id);
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    if (String(requestDoc.employeeId) !== authUser.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (!["Pending", "Level 1 Approved", "Approved"].includes(requestDoc.status)) {
      return res.status(400).json({
        success: false,
      message: "This leave request cannot be cancelled"
      });
    }

    if (!canCancelLeaveRequest(requestDoc.status, requestDoc.fromDate)) {
      return res.status(400).json({
        success: false,
        message: "Leave can only be cancelled before the leave start date"
      });
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const previousStatus = requestDoc.status;

      const balance = await LeaveBalance.findOne({
        employeeId: requestDoc.employeeId,
        leaveTypeId: requestDoc.leaveTypeId,
        cycleKey: requestDoc.balanceCycleKey
      }).session(session);

      if (!balance) {
        throw new Error("Leave balance record not found");
      }

      if (requestDoc.status === "Approved") {
        balance.used = Math.max(0, Number((balance.used - requestDoc.totalDays).toFixed(2)));
      } else {
        balance.pending = Math.max(0, Number((balance.pending - requestDoc.totalDays).toFixed(2)));
      }
      await balance.save({ session });

      requestDoc.status = "Cancelled";
      requestDoc.currentApprovalLevel = 0;
      requestDoc.cancelledAt = new Date();
      requestDoc.cancelledBy = new mongoose.Types.ObjectId(authUser.id);
      requestDoc.approvalHistory.push({
        level: 0,
        action: "Cancelled",
        by: new mongoose.Types.ObjectId(authUser.id),
        role: authUser.role,
        remarks: parsedBody.data.remarks || "",
        actedAt: new Date()
      });

      await requestDoc.save({ session });
      await session.commitTransaction();
      await recordAuditLog({
        actorId: authUser.id,
        actorRole: authUser.role,
        action: "leave.cancel",
        entityType: "leave_request",
        entityId: String(requestDoc._id),
        summary: `Cancelled leave request ${requestDoc._id}`,
        metadata: { previousStatus }
      });
      return res.status(200).json({ success: true, message: "Leave request cancelled successfully" });
    } catch (error: unknown) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: getErrorMessage(error, "Failed to cancel leave request") });
    } finally {
      session.endSession();
    }
  } catch {
    return res.status(500).json({ success: false, message: "Failed to cancel leave request" });
  }
};

export const getLeaveSummary = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    const summaryScope = req.query.scope === "self" ? "self" : "company";

    if (summaryScope === "self") {
      const [recentRequests, statusBuckets, activeTypes] = await Promise.all([
        LeaveRequest.find({ employeeId: authUser.id })
          .populate("leaveTypeId", "name code color")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        LeaveRequest.aggregate([
          { $match: { employeeId: new mongoose.Types.ObjectId(authUser.id) } },
          { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        LeaveType.find({ isDeleted: false, status: "Active" }).lean()
      ]);

      const balances = [];
      for (const leaveType of activeTypes) {
        try {
          const balance = await ensureLeaveBalance({
            employeeId: authUser.id,
            leaveType,
            cycleDate: new Date()
          });

          balances.push({
            leaveType: buildLeaveTypePayload(leaveType),
            cycleKey: balance.cycleKey,
            ...buildBalanceSummary(balance.toObject())
          });
        } catch {
          const cycle = getCycleParts(new Date(), leaveType.allocationPeriod);
          balances.push({
            leaveType: buildLeaveTypePayload(leaveType),
            cycleKey: cycle.cycleKey,
            ...buildBalanceSummary({
              totalAllocated: leaveType.totalAllocation,
              accrued: 0,
              carriedForward: 0,
              used: 0,
              pending: 0
            })
          });
        }
      }

      const summary = summarizeLeaveStatusBuckets(statusBuckets);

      return res.status(200).json({
        success: true,
        data: {
          summary,
          balances,
          recentRequests: recentRequests.map((item) => buildLeaveRequestPayload(item, authUser))
        }
      });
    }

    const todayStart = startOfDay(new Date());
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);
    const isTeamLeaderView = authUser.role === "teamLeader";
    const scopedEmployeeIds = isTeamLeaderView
      ? await getTeamLeaderScopedEmployeeIds(authUser.id)
      : [];
    const scopedEmployeeObjectIds = scopedEmployeeIds.map((id) => new mongoose.Types.ObjectId(id));
    const requestMatch =
      isTeamLeaderView
        ? { employeeId: { $in: scopedEmployeeObjectIds } }
        : {};
    const activeEmployeeMatch =
      isTeamLeaderView
        ? { _id: { $in: scopedEmployeeObjectIds } }
        : {};

    const [statusBuckets, employeesOnLeaveToday, activeEmployees, leaveTypes] = await Promise.all([
      LeaveRequest.aggregate([
        { $match: requestMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      LeaveRequest.countDocuments({
        ...requestMatch,
        status: "Approved",
        fromDate: { $lte: todayEnd },
        toDate: { $gte: todayStart }
      }),
      User.countDocuments({
        ...activeEmployeeMatch,
        role: { $in: LEAVE_SELF_SERVICE_ROLES },
        status: "Active",
        isDeleted: false
      }),
      LeaveRequest.aggregate([
        { $match: requestMatch },
        { $group: { _id: "$leaveTypeSnapshot.name", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 5 }
      ])
    ]);

    const counts = summarizeLeaveStatusBuckets(statusBuckets, true);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          ...counts,
          employeesOnLeaveToday,
          activeEmployees
        },
        topLeaveTypes: leaveTypes.map((item) => ({
          leaveTypeName: item._id,
          count: item.count
        }))
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave summary" });
  }
};

export const getLeaveCalendar = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    await purgeExpiredUnapprovedLeaveRequests();
    const parsed = leaveCalendarQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid calendar query" });
    }

    const start = new Date(parsed.data.year, parsed.data.month - 1, 1);
    const end = new Date(parsed.data.year, parsed.data.month, 0, 23, 59, 59, 999);

    const filter: Record<string, unknown> = {
      fromDate: { $lte: end },
      toDate: { $gte: start }
    };

    filter.status = "Approved";

    if (authUser.role === "employee") {
      filter.employeeId = authUser.id;
    } else if (authUser.role === "teamLeader") {
      const scopedEmployeeIds = await getTeamLeaderScopedEmployeeIds(authUser.id);
      if (parsed.data.employeeId) {
        if (!scopedEmployeeIds.includes(parsed.data.employeeId)) {
          return res.status(200).json({
            success: true,
            data: {
              items: []
            }
          });
        }

        filter.employeeId = parsed.data.employeeId;
      } else {
        filter.employeeId = { $in: scopedEmployeeIds };
      }
    } else if (parsed.data.employeeId) {
      filter.employeeId = parsed.data.employeeId;
    }

    const targetEmployee =
      filter.employeeId && mongoose.Types.ObjectId.isValid(String(filter.employeeId))
        ? await User.findById(String(filter.employeeId)).select("department").lean()
        : authUser.role === "employee"
          ? await User.findById(authUser.id).select("department").lean()
          : null;

    const [items, holidays] = await Promise.all([
      LeaveRequest.find(filter)
        .populate("employeeId", "name email")
        .sort({ fromDate: 1, createdAt: -1 })
        .lean(),
      getApplicableHolidays({
        fromDate: start,
        toDate: end,
        departmentId: targetEmployee?.department ? String(targetEmployee.department) : null
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: [
          ...holidays.map((item) => ({
            id: `holiday-${item._id}`,
            kind: "holiday",
            title: item.name,
            employeeName: "",
            leaveTypeName: item.name,
            leaveTypeCode: "HOL",
            color: "#f59e0b",
            fromDate: item.date,
            toDate: item.date,
            totalDays: 0,
            status: null,
            description: item.description
          })),
          ...items.map((item) => ({
            id: item._id,
            kind: "leave",
            title: `${getPopulatedUserName(item.employeeId) || "Employee"} - ${item.leaveTypeSnapshot?.code ?? ""}`,
            employeeName: getPopulatedUserName(item.employeeId),
            leaveTypeName: item.leaveTypeSnapshot?.name ?? "",
            leaveTypeCode: item.leaveTypeSnapshot?.code ?? "",
            color: item.leaveTypeSnapshot?.color ?? "#2563eb",
            fromDate: item.fromDate,
            toDate: item.toDate,
            totalDays: item.totalDays,
            status: item.status,
            description: ""
          }))
        ]
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leave calendar" });
  }
};

export const listLeaveHolidays = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    const parsed = holidayListQuerySchema.safeParse({
      ...req.query,
      scope: req.query.scope ? normalizeHolidayScope(String(req.query.scope)) : ""
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday filters" });
    }

    await ensureHolidayIndexes();
    const items = await listScopedHolidays(parsed.data);
    const payloads = items.map(buildHolidayPayload);

    if (!hasAnyRole(authUser.role, LEAVE_HOLIDAY_MANAGER_ROLES)) {
      const user = await User.findById(authUser.id).select("department").lean();
      const departmentId = user?.department ? String(user.department) : null;

      return res.status(200).json({
        success: true,
        data: {
          items: payloads.filter((item) => item.scope === "COMPANY" || item.departmentId === departmentId)
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        items: payloads
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch holidays" });
  }
};

export const createLeaveHoliday = async (req: Request, res: Response) => {
  try {
    const parsed = holidaySchema.safeParse({
      ...req.body,
      scope: normalizeHolidayScope(typeof req.body?.scope === "string" ? req.body.scope : undefined)
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const date = startOfDay(parsed.data.date);
    const dateKey = toYmd(date);
    const department =
      parsed.data.scope === "DEPARTMENT"
        ? await validateHolidayDepartment(parsed.data.departmentId)
        : null;

    if (parsed.data.scope === "DEPARTMENT" && !department) {
      return res.status(400).json({ success: false, message: "Invalid department" });
    }

    await ensureHolidayIndexes();
    const existing = await Holiday.findOne(
      buildHolidayConflictFilter({
        dateKey,
        scope: parsed.data.scope,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null
      })
    ).lean();
    if (existing) {
      return res.status(400).json({ success: false, message: "Holiday already exists for the selected date" });
    }

    const created = await Holiday.create({
      ...parsed.data,
      departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
      date,
      dateKey,
      createdBy: authUser.id,
      updatedBy: authUser.id
    });
    const createdWithDepartment = await Holiday.findById(created._id).populate("departmentId", "name").lean();

    return res.status(201).json({
      success: true,
      message: "Holiday created successfully",
      data: buildHolidayPayload(createdWithDepartment || created)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create holiday" });
  }
};

export const updateLeaveHoliday = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday id" });
    }

    const parsed = holidaySchema.safeParse({
      ...req.body,
      scope: normalizeHolidayScope(typeof req.body?.scope === "string" ? req.body.scope : undefined)
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const authUser = getAuthUser(req);
    const date = startOfDay(parsed.data.date);
    const dateKey = toYmd(date);
    const department =
      parsed.data.scope === "DEPARTMENT"
        ? await validateHolidayDepartment(parsed.data.departmentId)
        : null;

    if (parsed.data.scope === "DEPARTMENT" && !department) {
      return res.status(400).json({ success: false, message: "Invalid department" });
    }

    await ensureHolidayIndexes();
    const conflict = await Holiday.findOne(
      buildHolidayConflictFilter({
        dateKey,
        scope: parsed.data.scope,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
        excludeId: parsedParam.data.id
      })
    ).lean();

    if (conflict) {
      return res.status(400).json({ success: false, message: "Holiday already exists for the selected date" });
    }

    const updated = await Holiday.findByIdAndUpdate(
      parsedParam.data.id,
      {
        ...parsed.data,
        departmentId: parsed.data.scope === "DEPARTMENT" ? parsed.data.departmentId : null,
        date,
        dateKey,
        updatedBy: authUser.id
      },
      { returnDocument: "after", runValidators: true }
    )
      .populate("departmentId", "name")
      .lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Holiday updated successfully",
      data: buildHolidayPayload(updated)
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update holiday" });
  }
};

export const deleteLeaveHoliday = async (req: Request, res: Response) => {
  try {
    const parsedParam = idParamSchema.safeParse(req.params);
    if (!parsedParam.success) {
      return res.status(400).json({ success: false, message: "Invalid holiday id" });
    }

    const deleted = await Holiday.findByIdAndDelete(parsedParam.data.id).lean();
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Holiday deleted successfully"
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete holiday" });
  }
};

export const runLeaveAutomation = async (req: Request, res: Response) => {
  try {
    const authUser = getAuthUser(req);
    if (authUser.role !== "superadmin" && authUser.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admin or superadmin can run leave automation" });
    }

    const parsed = leaveProcessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatZodError(parsed.error)
      });
    }

    const [carryForward, accrual] = await Promise.all([
      processCarryForward(parsed.data.runDate),
      processMonthlyAccrual(parsed.data.runDate)
    ]);

    return res.status(200).json({
      success: true,
      message: "Leave automation processed successfully",
      data: {
        runDate: toYmd(parsed.data.runDate),
        carryForward,
        accrual
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to process leave automation" });
  }
};
