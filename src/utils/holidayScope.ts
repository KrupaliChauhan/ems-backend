import Holiday from "../models/Holiday";

export const HOLIDAY_SCOPE_VALUES = ["COMPANY", "DEPARTMENT"] as const;

export type HolidayScope = (typeof HOLIDAY_SCOPE_VALUES)[number];

const HOLIDAY_SCOPE_ALIASES: Record<HolidayScope, string[]> = {
  COMPANY: ["company", "all", "global", "branch", "office"],
  DEPARTMENT: ["department", "dept"]
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeHolidayScope(scope?: string | null): HolidayScope {
  const value = String(scope || "")
    .toLowerCase()
    .trim();

  if (!value) return "COMPANY";
  if (HOLIDAY_SCOPE_ALIASES.COMPANY.includes(value)) return "COMPANY";
  if (HOLIDAY_SCOPE_ALIASES.DEPARTMENT.includes(value)) return "DEPARTMENT";

  return "COMPANY";
}

export function getHolidayScopeAliases(scope?: string | null) {
  const normalized = normalizeHolidayScope(scope);
  return [normalized, ...HOLIDAY_SCOPE_ALIASES[normalized]];
}

export function getHolidayScopeSearchPattern(scope?: string | null) {
  const aliases = getHolidayScopeAliases(scope);
  return new RegExp(`^(${aliases.map(escapeRegExp).join("|")})$`, "i");
}

export function getEffectiveHolidayScope(holiday: {
  scope?: string | null;
  departmentId?: unknown;
}) {
  const normalized = normalizeHolidayScope(holiday.scope);
  const departmentRecord =
    typeof holiday.departmentId === "object" && holiday.departmentId !== null
      ? (holiday.departmentId as Record<string, unknown>)
      : null;
  const hasDepartmentId = departmentRecord ? Boolean(departmentRecord._id) : Boolean(holiday.departmentId);

  if (normalized === "DEPARTMENT" && hasDepartmentId) {
    return "DEPARTMENT" as const;
  }

  return "COMPANY" as const;
}

function buildCompanyHolidayOrClauses() {
  return [
    { scope: getHolidayScopeSearchPattern("COMPANY") },
    {
      scope: getHolidayScopeSearchPattern("DEPARTMENT"),
      $or: [{ departmentId: null }, { departmentId: { $exists: false } }]
    }
  ];
}

export function buildHolidayConflictFilter(params: {
  dateKey: string;
  scope: HolidayScope;
  departmentId?: string | null;
  excludeId?: string;
}) {
  const filter: Record<string, unknown> = { dateKey: params.dateKey };

  if (params.excludeId) {
    filter._id = { $ne: params.excludeId };
  }

  if (params.scope === "DEPARTMENT" && params.departmentId) {
    filter.scope = getHolidayScopeSearchPattern("DEPARTMENT");
    filter.departmentId = params.departmentId;
    return filter;
  }

  filter.$or = buildCompanyHolidayOrClauses();
  return filter;
}

export function buildApplicableHolidayFilter(params: {
  fromDate?: Date;
  toDate?: Date;
  dateKey?: string;
  departmentId?: string | null;
  isActive?: boolean;
}) {
  const filter: Record<string, unknown> = {};

  if (params.isActive !== false) {
    filter.isActive = true;
  }

  if (params.dateKey) {
    filter.dateKey = params.dateKey;
  } else if (params.fromDate && params.toDate) {
    filter.date = {
      $gte: params.fromDate,
      $lte: params.toDate
    };
  }

  const orClauses: Record<string, unknown>[] = [...buildCompanyHolidayOrClauses()];
  if (params.departmentId) {
    orClauses.push({
      scope: getHolidayScopeSearchPattern("DEPARTMENT"),
      departmentId: params.departmentId
    });
  }

  filter.$or = orClauses;
  return filter;
}

let indexesEnsured = false;

export async function ensureHolidayIndexes() {
  if (indexesEnsured) return;

  try {
    const exists = await Holiday.collection.indexExists("dateKey_1_scope_1");
    if (exists) {
      await Holiday.collection.dropIndex("dateKey_1_scope_1");
    }
  } catch {
    // ignore when collection/index does not exist
  }

  try {
    await Holiday.collection.createIndex(
      { dateKey: 1, scope: 1, departmentId: 1 },
      { unique: true, name: "dateKey_1_scope_1_departmentId_1" }
    );
  } catch {
    // rely on existing indexes if creation fails
  }

  indexesEnsured = true;
}
