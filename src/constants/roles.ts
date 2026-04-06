export const APP_ROLES = [
  "superadmin",
  "admin",
  "employee",
  "HR",
  "teamLeader"
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const MASTER_ACCESS_ROLES = ["superadmin", "admin", "HR"] as const;
export const USER_VIEW_ROLES = ["superadmin", "admin", "HR"] as const;
export const USER_MANAGE_ROLES = ["superadmin", "admin", "HR"] as const;
export const PROJECT_MANAGER_ROLES = ["superadmin", "admin", "teamLeader"] as const;
export const ATTENDANCE_MANAGER_ROLES = ["superadmin", "admin", "HR"] as const;
export const SELF_ATTENDANCE_ROLES = ["employee", "teamLeader", "HR"] as const;
export const LEAVE_SELF_SERVICE_ROLES = ["employee", "teamLeader", "HR"] as const;
export const LEAVE_TYPE_MANAGER_ROLES = ["superadmin", "admin", "HR"] as const;
export const LEAVE_REQUEST_VIEW_ROLES = ["superadmin", "admin", "HR", "teamLeader"] as const;
export const LEAVE_HOLIDAY_MANAGER_ROLES = ["superadmin", "admin", "HR"] as const;
export const LEAVE_APPROVER_ROLES = ["superadmin", "admin", "HR", "teamLeader"] as const;
export const COMMUNICATION_MANAGER_ROLES = ["superadmin", "admin", "HR"] as const;
export const COMMUNICATION_VIEW_REPORT_ROLES = ["superadmin", "admin", "HR"] as const;
export const COMMUNICATION_RSVP_ROLES = ["employee", "teamLeader", "HR", "admin", "superadmin"] as const;

export function hasAnyRole(
  role: string | undefined,
  allowedRoles: readonly AppRole[],
) {
  return !!role && allowedRoles.includes(role as AppRole);
}


