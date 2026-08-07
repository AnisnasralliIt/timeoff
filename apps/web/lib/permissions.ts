import { prisma, type Role } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";

/** Roles with company-wide visibility (no department scoping). */
export const COMPANY_WIDE_ROLES: ReadonlySet<Role> = new Set([
  "EXECUTIVE",
  "HR",
  "ADMIN",
  "SUPER_ADMIN",
]);

/** Roles that can run the people admin console (users, departments, leave types, balances). */
export const PEOPLE_OPS_ROLES: ReadonlySet<Role> = new Set(["HR", "ADMIN", "SUPER_ADMIN"]);

/** Roles that can view company-wide workforce insights. */
export const INSIGHT_ROLES: ReadonlySet<Role> = new Set(["EXECUTIVE", "HR", "ADMIN", "SUPER_ADMIN"]);

/** Roles that can approve/reject leave requests. */
export const APPROVER_ROLES: ReadonlySet<Role> = new Set(["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"]);

export function canManageUsers(user: SessionUser): boolean {
  return PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE");
}

export function canViewInsights(user: SessionUser): boolean {
  return INSIGHT_ROLES.has(user.role ?? "EMPLOYEE");
}

export function canApprove(user: SessionUser): boolean {
  return APPROVER_ROLES.has(user.role ?? "EMPLOYEE");
}

/**
 * Role-assignment rule: ADMIN can only be granted by SUPER_ADMIN, and
 * SUPER_ADMIN is never assignable through the API (seeded only).
 */
export function canGrantRole(actor: SessionUser, targetRole: Role): boolean {
  if (targetRole === "SUPER_ADMIN") return false;
  if (targetRole === "ADMIN") return actor.role === "SUPER_ADMIN";
  return canManageUsers(actor);
}

export type UserScope = { kind: "all" } | { kind: "department"; departmentId: string };

/** The visibility scope implied by a role. */
export function getUserScope(user: SessionUser): UserScope {
  if (COMPANY_WIDE_ROLES.has(user.role ?? "EMPLOYEE")) return { kind: "all" };
  return { kind: "department", departmentId: user.departmentId ?? "" };
}

/** Authoritative current departmentId from the DB (session may be stale). */
export async function resolveDepartmentId(user: SessionUser): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { departmentId: true },
  });
  return row?.departmentId ?? null;
}

/**
 * Canonical "which users may this actor see?" resolver. Returns "all" for
 * company-wide roles, otherwise the ids of active users in the actor's own
 * department (single helper, used by calendar, dashboard, workforce, etc.).
 */
export async function getVisibleUserIds(user: SessionUser): Promise<"all" | string[]> {
  const scope = getUserScope(user);
  if (scope.kind === "all") return "all";
  const departmentId = (await resolveDepartmentId(user)) ?? scope.departmentId;
  const rows = await prisma.user.findMany({
    where: { companyId: user.companyId, departmentId, status: "ACTIVE" },
    select: { id: true },
  });
  return rows.map((r: (typeof rows)[number]) => r.id);
}
