import { prisma, Prisma, type AuditLog } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";
import { PEOPLE_OPS_ROLES, resolveDepartmentId } from "@/lib/permissions";

/** Thrown when the actor is not allowed to read audit data. */
export class AuditAccessError extends Error {
  constructor(message = "Audit access required.") {
    super(message);
    this.name = "AuditAccessError";
  }
}

/** Roles allowed to read the audit log. EMPLOYEE and EXECUTIVE are excluded. */
export function canViewAuditLog(user: SessionUser): boolean {
  return user.role === "MANAGER" || PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE");
}

export interface AuditLogQuery {
  search?: string;
  action?: string;
  entityType?: string;
  actorId?: string;
  employeeId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogPage {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Reads the audit log under the actor's visibility scope, enforced in SQL:
 *  - HR/ADMIN/SUPER_ADMIN: whole company
 *  - MANAGER: events whose `employeeId` belongs to the manager's own team
 *    (active users in their department), so a manager can never see another
 *    department's trail — even by guessing an id in a filter.
 * EMPLOYEE/EXECUTIVE get an AuditAccessError (caller maps to 403).
 */
export async function listAuditLog(user: SessionUser, query: AuditLogQuery = {}): Promise<AuditLogPage> {
  if (!canViewAuditLog(user)) {
    throw new AuditAccessError();
  }
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)));

  const where: Prisma.AuditLogWhereInput = { companyId: user.companyId };
  const extra: Prisma.AuditLogWhereInput[] = [];

  if (user.role === "MANAGER") {
    const departmentId = await resolveDepartmentId(user);
    const team = await prisma.user.findMany({
      where: { companyId: user.companyId, status: "ACTIVE", ...(departmentId ? { departmentId } : {}) },
      select: { id: true },
    });
    const teamIds = team.map((t: { id: string }) => t.id);
    // Hard SQL-level scope: the manager can only ever see events tied to their
    // own team. A guessed employeeId outside the team must not widen the view.
    where.employeeId = { in: teamIds };
    if (query.employeeId) extra.push({ employeeId: query.employeeId });
  } else if (query.employeeId) {
    where.employeeId = query.employeeId;
  }

  if (query.search) {
    const term = query.search.trim();
    where.OR = [
      { actorNameSnapshot: { contains: term, mode: "insensitive" } },
      { entityNameSnapshot: { contains: term, mode: "insensitive" } },
      { action: { contains: term, mode: "insensitive" } },
      { entityType: { contains: term, mode: "insensitive" } },
      { entityId: { contains: term, mode: "insensitive" } },
    ];
  }
  if (query.action) where.action = query.action;
  if (query.entityType) where.entityType = query.entityType;
  if (query.actorId) where.actorId = query.actorId;
  if (query.from) where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), gte: new Date(`${query.from}T00:00:00.000Z`) };
  if (query.to) {
    const end = new Date(`${query.to}T23:59:59.999Z`);
    where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), lte: end };
  }
  if (extra.length > 0) where.AND = extra;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
