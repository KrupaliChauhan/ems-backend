import AuditLog from "../models/AuditLog";
import type { AppRole } from "../constants/roles";
import { logServerError } from "../utils/serverLogger";

type AuditInput = {
  actorId: string;
  actorRole: AppRole;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
};

export async function recordAuditLog(input: AuditInput) {
  try {
    await AuditLog.create({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata ?? null
    });
  } catch (error) {
    logServerError("audit.log", error);
  }
}

