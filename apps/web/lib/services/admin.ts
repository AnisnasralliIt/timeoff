import bcrypt from "bcryptjs";
import { prisma, type Role, type UserStatus } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";
import { audit, LeaveError, listPendingForApproval, seedBalancesForNewUser, syncCurrentAccruals } from "@/lib/services/leave";
import { enqueueOutbox } from "@/lib/emails";
import { enqueueEmails } from "@/lib/queue";
import { canGrantRole, canManageUsers, getVisibleUserIds, isSupervisorRole } from "@/lib/permissions";
import { deleteObject } from "@/lib/attachments/storage";

export { LeaveError };

export function requireHr(user: SessionUser): void {
  if (!canManageUsers(user)) {
    throw new LeaveError("HR access required.");
  }
}

/* ------------------------------- Overview -------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active employees (within the actor's visibility scope) with an incomplete profile. */
export async function usersWithMissingInfo(user: SessionUser): Promise<{ id: string; name: string; missing: string[] }[]> {
  requireHr(user);
  const companyId = user.companyId!;
  const visible = await getVisibleUserIds(user);
  const rows = await prisma.user.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      ...(visible === "all" ? {} : { id: { in: visible } }),
    },
    select: { id: true, name: true, managerId: true, title: true },
    orderBy: { name: "asc" },
  });
  const flagged: { id: string; name: string; missing: string[] }[] = [];
  for (const row of rows) {
    const missing: string[] = [];
    if (!row.managerId) missing.push("manager");
    if (!row.title) missing.push("title");
    if (missing.length > 0) flagged.push({ id: row.id, name: row.name, missing });
  }
  return flagged;
}

export interface BalanceIssueRow {
  balanceId: string | null;
  userId: string;
  userName: string;
  leaveType: string;
  periodStart: string;
  available: number;
  reason: "negative" | "inconsistent";
}

/**
 * Current-period balances that violate the ledger's own invariants:
 * - negative: the balance is below zero (cannot be carried on current accrual rules)
 * - inconsistent: used or pending counters contradict their accumulators (< 0)
 * Scoped to the actor's visible users; same source used by the admin overview and
 * the filtered balances page so the dashboard count always matches the results.
 */
export async function balanceIssueRows(user: SessionUser): Promise<BalanceIssueRow[]> {
  requireHr(user);
  const companyId = user.companyId!;
  await syncCurrentAccruals(prisma, companyId);
  const today = new Date().toISOString().slice(0, 10);
  const visible = await getVisibleUserIds(user);
  const balances = await prisma.leaveBalance.findMany({
    where: {
      companyId,
      periodStart: { lte: today },
      periodEnd: { gte: today },
      ...(visible === "all" ? {} : { userId: { in: visible } }),
    },
    include: { user: { select: { id: true, name: true } }, leaveType: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const rows: BalanceIssueRow[] = [];
  for (const b of balances) {
    const available = b.accrued + b.carriedOver + b.adjustment - b.used - b.pending;
    if (available < -0.005) {
      rows.push({
        balanceId: b.id,
        userId: b.user.id,
        userName: b.user.name,
        leaveType: b.leaveType.name,
        periodStart: b.periodStart,
        available,
        reason: "negative",
      });
    }
    if (b.used < -0.005 || b.pending < -0.005) {
      rows.push({
        balanceId: b.id,
        userId: b.user.id,
        userName: b.user.name,
        leaveType: b.leaveType.name,
        periodStart: b.periodStart,
        available,
        reason: "inconsistent",
      });
    }
  }
  return rows.sort((a, b) => a.userName.localeCompare(b.userName));
}

export async function adminStats(user: SessionUser) {
  requireHr(user);
  const companyId = user.companyId!;
  // Reconcile current-year rows to the cumulative accrual before reporting.
  await syncCurrentAccruals(prisma, companyId);
  const today = new Date().toISOString().slice(0, 10);
  const [
    activeUsers,
    departments,
    leaveTypes,
    delegations,
    balances,
    upcoming,
    statusCounts,
    onboardingCount,
    pendingRequests,
    missingInfo,
    balanceIssue,
  ] = await Promise.all([
    prisma.user.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.department.count({ where: { companyId } }),
    prisma.leaveType.count({ where: { companyId } }),
    prisma.approvalDelegation.count({ where: { companyId, active: true } }),
    prisma.leaveBalance.findMany({
      where: { companyId, periodStart: { lte: today }, periodEnd: { gte: today } },
      include: { user: { select: { id: true, name: true } }, leaveType: { select: { id: true, name: true } } },
    }),
    prisma.leaveRequest.count({
      where: {
        companyId,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { gte: today },
      },
    }),
    prisma.user.groupBy({
      by: ["status"],
      where: { companyId },
      _count: { _all: true },
    }),
    // New hires whose employment has not started yet are "onboarding".
    prisma.user.count({
      where: { companyId, status: "ACTIVE", employmentStartDate: { gt: today } },
    }),
    // Same source as the /approvals page so the dashboard count always matches it.
    listPendingForApproval(user),
    usersWithMissingInfo(user),
    balanceIssueRows(user),
  ]);

  const statusOf = new Map(statusCounts.map((s: (typeof statusCounts)[number]) => [s.status, s._count._all]));
  const totalEmployees = [...statusOf.values()].reduce((s, n) => s + n, 0);
  const inactive = statusOf.get("INACTIVE") ?? 0;
  const offboarding = statusOf.get("OFFBOARDED") ?? 0;
  const onboarding = onboardingCount;
  const active = activeUsers - onboarding;

  const available = balances.reduce(
    (s: number, b: (typeof balances)[number]) => s + (b.accrued + b.carriedOver + b.adjustment - b.used - b.pending),
    0,
  );
  const balanceIssues = balanceIssue.length;
  const balanceEmployees = new Set(balances.map((b: (typeof balances)[number]) => b.user.id)).size;
  const byType = new Map<string, { name: string; available: number; used: number; pending: number; employees: Set<string> }>();
  for (const b of balances) {
    let entry = byType.get(b.leaveType.id);
    if (!entry) {
      entry = { name: b.leaveType.name, available: 0, used: 0, pending: 0, employees: new Set() };
      byType.set(b.leaveType.id, entry);
    }
    entry.available += b.accrued + b.carriedOver + b.adjustment - b.used - b.pending;
    entry.used += b.used;
    entry.pending += b.pending;
    entry.employees.add(b.user.id);
  }
  const balanceTotals = [...byType.values()]
    .map((e) => ({ name: e.name, available: e.available, used: e.used, pending: e.pending, employees: e.employees.size }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const now = Date.now();
  const olderThan3 = pendingRequests.filter((r: (typeof pendingRequests)[number]) => now - r.createdAt.getTime() > 3 * DAY_MS).length;
  const olderThan7 = pendingRequests.filter((r: (typeof pendingRequests)[number]) => now - r.createdAt.getTime() > 7 * DAY_MS).length;

  return {
    activeUsers,
    pendingRequests: pendingRequests.length,
    pendingApprovals: { total: pendingRequests.length, olderThan3, olderThan7 },
    departments,
    leaveTypes,
    delegations,
    available,
    upcoming,
    totalEmployees,
    employeeStatus: { active, onboarding, offboarding, inactive },
    missingInfo: { total: missingInfo.length, users: missingInfo },
    balanceIssues,
    balanceIssue: {
      total: new Set(balanceIssue.map((r: BalanceIssueRow) => r.balanceId)).size,
      negative: balanceIssue.filter((r: BalanceIssueRow) => r.reason === "negative").length,
      inconsistent: balanceIssue.filter((r: BalanceIssueRow) => r.reason === "inconsistent").length,
      rows: balanceIssue,
    },
    balanceEmployees,
    balanceTotals,
  };
}

/* --------------------------------- Users --------------------------------- */

export async function listUsersForAdmin(user: SessionUser) {
  requireHr(user);
  // Bring current-year accrued balances up to date so the directory shows the
  // cumulative balance (manual adjustments / carry-over are preserved).
  await syncCurrentAccruals(prisma, user.companyId!);
  const rows = await prisma.user.findMany({
    where: { companyId: user.companyId },
    include: {
      department: true,
      manager: { select: { id: true, name: true } },
      balances: { include: { leaveType: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((u: (typeof rows)[number]) => {
    // Multiple leave years now coexist (history rows are kept): prefer the
    // row covering today, falling back to the latest — never an arbitrary one.
    const today = new Date().toISOString().slice(0, 10);
    const vacations = u.balances.filter((b: (typeof u.balances)[number]) => b.leaveType.name === "Vacation");
    const vacation =
      vacations.find((b: (typeof u.balances)[number]) => b.periodStart <= today && b.periodEnd >= today) ??
      [...vacations].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      title: u.title,
      employmentStartDate: u.employmentStartDate,
      employmentType: u.employmentType,
      department: u.department?.name ?? null,
      manager: u.manager?.name ?? null,
      vacationAvailable: vacation
        ? vacation.accrued + vacation.carriedOver + vacation.adjustment - vacation.used - vacation.pending
        : null,
    };
  });
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  password: string;
  departmentId: string;
  managerId?: string;
  employmentType?: string;
  employmentStartDate: string;
  title?: string;
}

/** Validates that a managerId points at an active supervisor in the same company. */
async function assertValidManager(
  companyId: string,
  managerId: string | null | undefined,
): Promise<void> {
  if (!managerId) return;
  const manager = await prisma.user.findFirst({
    where: { id: managerId, companyId, status: "ACTIVE" },
    select: { role: true },
  });
  if (!manager) throw new LeaveError("The selected manager does not exist in this company.");
  if (!isSupervisorRole(manager.role)) {
    throw new LeaveError("Only managers and higher roles can be selected as a responsable.");
  }
}

export async function createUserForAdmin(user: SessionUser, input: CreateUserInput) {
  requireHr(user);
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim() || !email || !input.employmentStartDate) {
    throw new LeaveError("Name, email and start date are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LeaveError("Invalid email address.");
  if (!canGrantRole(user, input.role)) {
    throw new LeaveError(
      input.role === "ADMIN" || input.role === "SUPER_ADMIN"
        ? "Only a SUPER_ADMIN can assign this role."
        : "You cannot assign this role.",
    );
  }
  if (!input.password || input.password.length < 8) {
    throw new LeaveError("A password of at least 8 characters is required.");
  }
  const existing = await prisma.user.findFirst({ where: { companyId: user.companyId, email } });
  if (existing) throw new LeaveError("A user with this email already exists.");
  await assertValidManager(user.companyId!, input.managerId);

  const passwordHash = await bcrypt.hash(input.password, 10);
  const created = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        companyId: user.companyId!,
        email,
        name: input.name.trim(),
        role: input.role,
        employmentType: (input.employmentType as "FULL_TIME" | "PART_TIME" | "CONTRACTOR") ?? "FULL_TIME",
        employmentStartDate: input.employmentStartDate,
        departmentId: input.departmentId,
        managerId: input.managerId || null,
        title: input.title?.trim() || null,
        passwordHash,
      },
    });
    // L8: seed the current leave-year balance immediately using the accrual
    // engine's own math, so a new user's balance is correct from day one.
    const company = await tx.company.findUniqueOrThrow({ where: { id: createdUser.companyId } });
    await seedBalancesForNewUser(tx, company, createdUser);
    await audit(tx, {
      companyId: createdUser.companyId,
      actorId: user.id,
      action: "user.create",
      entityType: "User",
      entityId: createdUser.id,
      entityName: createdUser.name,
      employeeId: createdUser.id,
      after: { email, role: input.role, departmentId: input.departmentId },
    });
    return createdUser;
  });
  return created;
}

export interface UpdateUserInput {
  role?: Role;
  status?: UserStatus;
  departmentId?: string;
  managerId?: string | null;
  employmentType?: string;
  employmentStartDate?: string;
  title?: string;
}

export async function updateUserForAdmin(user: SessionUser, userId: string, input: UpdateUserInput) {
  requireHr(user);
  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: user.companyId },
  });
  if (!target) throw new LeaveError("User not found.");
  if (target.id === user.id && (input.status === "INACTIVE" || input.status === "OFFBOARDED")) {
    throw new LeaveError("You cannot deactivate your own account.");
  }
  if (input.managerId === userId) throw new LeaveError("A user cannot be their own manager.");
  await assertValidManager(user.companyId!, input.managerId);
  if (input.role && input.role !== target.role && !canGrantRole(user, input.role)) {
    throw new LeaveError(
      input.role === "ADMIN" || input.role === "SUPER_ADMIN"
        ? "Only a SUPER_ADMIN can assign this role."
        : "You cannot assign this role.",
    );
  }
  const targetPrivileged = target.role === "ADMIN" || target.role === "SUPER_ADMIN";
  const nextPrivileged = input.role === "ADMIN" || input.role === "SUPER_ADMIN";
  if (input.role && input.role !== target.role && user.role !== "SUPER_ADMIN" && (targetPrivileged || nextPrivileged)) {
    throw new LeaveError("Only a SUPER_ADMIN can change privileged roles.");
  }

  const before = {
    role: target.role,
    status: target.status,
    departmentId: target.departmentId,
    managerId: target.managerId,
  };
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      role: input.role ?? target.role,
      status: input.status ?? target.status,
      departmentId: input.departmentId ?? target.departmentId,
      managerId: input.managerId === undefined ? target.managerId : input.managerId,
      employmentType: (input.employmentType as "FULL_TIME" | "PART_TIME" | "CONTRACTOR") ?? target.employmentType,
      employmentStartDate: input.employmentStartDate ?? target.employmentStartDate,
      title: input.title === undefined ? target.title : input.title?.trim() || null,
    },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "user.update",
    entityType: "User",
    entityId: userId,
    entityName: target.name,
    employeeId: userId,
    before,
    after: {
      role: updated.role,
      status: updated.status,
      departmentId: updated.departmentId,
      managerId: updated.managerId,
    },
  });
  return updated;
}

/**
 * True, permanent, cascading hard deletion (irreversible). The user's *own*
 * rows are deleted: leave requests (+ days + approval steps + attachments),
 * leave balances, notifications, delegations they own, attachments they
 * uploaded, iCal integrations. Records *owned by other people* that merely
 * reference this user are reference-cleaned, never deleted — a colleague's
 * request that this user approved or decided keeps its approval history
 * (`approvedById`, `cancelledById`, `effectiveApproverId`, approval steps
 * nulled), reports keep their record with `managerId` cleared, and audit logs
 * keep the company history with `actorId` nulled. Attachment blobs are purged
 * from storage best-effort (a storage failure never blocks the deletion).
 * Guarded like a role change: only SUPER_ADMIN may delete privileged users,
 * and nobody can delete their own account.
 */
export async function deleteUserForAdmin(user: SessionUser, userId: string) {
  requireHr(user);
  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: user.companyId },
  });
  if (!target) throw new LeaveError("User not found.");
  if (target.id === user.id) throw new LeaveError("You cannot delete your own account.");
  if ((target.role === "ADMIN" || target.role === "SUPER_ADMIN") && user.role !== "SUPER_ADMIN") {
    throw new LeaveError("Only a SUPER_ADMIN can delete privileged users.");
  }

  const attachmentKeys = (
    await prisma.attachment.findMany({ where: { uploaderId: userId }, select: { storageKey: true } })
  ).map((a: { storageKey: string }) => a.storageKey);

  await prisma.$transaction(async (tx) => {
    // Reference cleanup on records owned by *other* users — clear, don't delete.
    await tx.user.updateMany({ where: { managerId: userId }, data: { managerId: null } });
    await tx.leaveRequest.updateMany({ where: { approvedById: userId }, data: { approvedById: null } });
    await tx.leaveRequest.updateMany({ where: { cancelledById: userId }, data: { cancelledById: null } });
    await tx.leaveRequest.updateMany({ where: { delegateToId: userId }, data: { delegateToId: null } });
    await tx.leaveRequest.updateMany({ where: { effectiveApproverId: userId }, data: { effectiveApproverId: null } });
    await tx.approvalStep.updateMany({ where: { approverId: userId }, data: { approverId: null } });
    await tx.approvalDelegation.updateMany({ where: { delegateId: userId }, data: { delegateId: null } });
    await tx.approvalRule.updateMany({ where: { specificUserId: userId }, data: { specificUserId: null } });
    await tx.approvalRule.updateMany({ where: { delegateToUserId: userId }, data: { delegateToUserId: null } });
    await tx.integration.updateMany({ where: { userId }, data: { userId: null } });
    await tx.auditLog.updateMany({ where: { actorId: userId }, data: { actorId: null } });

    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "user.delete",
      entityType: "User",
      entityId: userId,
      entityName: target.name,
      employeeId: userId,
      before: { name: target.name, email: target.email, role: target.role, status: target.status },
      after: { deleted: true },
    });

    // Cascades the user's own rows (balances, notifications, requests + days +
    // steps, attachments uploaded, delegations owned).
    await tx.user.delete({ where: { id: userId } });
  });

  // Best-effort blob purge for the deleted user's attachments.
  for (const key of attachmentKeys) {
    try {
      await deleteObject(key);
    } catch {
      // Storage failure must never roll back the deletion.
    }
  }

  return { ok: true as const };
}

/* ------------------------------ Departments ------------------------------ */

export async function listDepartmentsForAdmin(user: SessionUser) {
  requireHr(user);
  const departments = await prisma.department.findMany({
    where: { companyId: user.companyId },
    include: { _count: { select: { users: true } }, users: { select: { id: true } } },
    orderBy: { sortOrder: "asc" },
  });
  return departments.map((d: (typeof departments)[number]) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    sortOrder: d.sortOrder,
    users: d._count.users,
  }));
}

export async function createDepartmentForAdmin(user: SessionUser, name: string, code?: string) {
  requireHr(user);
  if (!name.trim()) throw new LeaveError("Department name is required.");
  const existing = await prisma.department.findFirst({
    where: { companyId: user.companyId, name: name.trim() },
  });
  if (existing) throw new LeaveError("A department with this name already exists.");
  const created = await prisma.department.create({
    data: {
      companyId: user.companyId!,
      name: name.trim(),
      code: code?.trim() || null,
      sortOrder: (await prisma.department.count({ where: { companyId: user.companyId } })) + 1,
    },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "department.create",
    entityType: "Department",
    entityId: created.id,
    entityName: created.name,
    after: { name: created.name, code: created.code },
  });
  return created;
}

export async function renameDepartmentForAdmin(user: SessionUser, departmentId: string, name: string) {
  requireHr(user);
  if (!name.trim()) throw new LeaveError("Department name is required.");
  const target = await prisma.department.findFirst({
    where: { id: departmentId, companyId: user.companyId },
  });
  if (!target) throw new LeaveError("Department not found.");
  const updated = await prisma.department.update({
    where: { id: departmentId },
    data: { name: name.trim() },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "department.rename",
    entityType: "Department",
    entityId: departmentId,
    entityName: updated.name,
    before: { name: target.name },
    after: { name: updated.name },
  });
  return updated;
}

/**
 * Permanently deletes a department — only when nothing references it. Any
 * members, department-specific policies, approval rules or child departments
 * block the deletion with a clear message so nothing is orphaned.
 */
export async function deleteDepartmentForAdmin(user: SessionUser, departmentId: string) {
  requireHr(user);
  const target = await prisma.department.findFirst({
    where: { id: departmentId, companyId: user.companyId },
  });
  if (!target) throw new LeaveError("Department not found.");
  const [members, policies, rules, children] = await Promise.all([
    prisma.user.count({ where: { departmentId, companyId: user.companyId } }),
    prisma.leavePolicy.count({ where: { departmentId, companyId: user.companyId } }),
    prisma.approvalRule.count({ where: { departmentId, companyId: user.companyId } }),
    prisma.department.count({ where: { parentId: departmentId } }),
  ]);
  if (members > 0 || policies > 0 || rules > 0 || children > 0) {
    throw new LeaveError(
      "This department is still in use — move its members and policies before deleting it.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.department.delete({ where: { id: departmentId } });
    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "department.delete",
      entityType: "Department",
      entityId: departmentId,
      entityName: target.name,
      before: { name: target.name, code: target.code },
    });
  });
}

/* ------------------------- Leave types & policies ------------------------ */

export async function listLeaveTypesForAdmin(user: SessionUser, opts: { showArchived?: boolean } = {}) {
  requireHr(user);
  return prisma.leaveType.findMany({
    where: { companyId: user.companyId, ...(opts.showArchived ? {} : { isArchived: false }) },
    include: {
      policies: true,
      _count: { select: { requests: true, balances: true } },
    },
    orderBy: [{ isArchived: "asc" }, { sortOrder: "asc" }],
  });
}

export interface CreateLeaveTypeInput {
  name: string;
  color: string;
  unit?: string;
  requiresApproval: boolean;
  requiresAttachment: boolean;
  isPaid: boolean;
  annualAllotment: number;
  carryOverDays: number;
  negativeAllowed: boolean;
  probationDays: number;
}

export async function createLeaveTypeForAdmin(user: SessionUser, input: CreateLeaveTypeInput) {
  requireHr(user);
  if (!input.name.trim()) throw new LeaveError("Leave type name is required.");
  const created = await prisma.$transaction(async (tx) => {
    const leaveType = await tx.leaveType.create({
      data: {
        companyId: user.companyId!,
        name: input.name.trim(),
        color: input.color || "#2e9486",
        unit: (input.unit as "DAYS" | "HOURS") ?? "DAYS",
        requiresApproval: input.requiresApproval,
        requiresAttachment: input.requiresAttachment,
        isPaid: input.isPaid,
        isSystem: false,
        sortOrder: await tx.leaveType.count({ where: { companyId: user.companyId } }),
      },
    });
    await tx.leavePolicy.create({
      data: {
        companyId: user.companyId!,
        name: `${input.name.trim()} Policy`,
        leaveTypeId: leaveType.id,
        annualAllotment: Number(input.annualAllotment) || 0,
        carryOverDays: Number(input.carryOverDays) || 0,
        negativeAllowed: input.negativeAllowed,
        probationDays: Number(input.probationDays) || 0,
      },
    });
    return leaveType;
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "leaveType.create",
    entityType: "LeaveType",
    entityId: created.id,
    entityName: created.name,
    after: { name: created.name, unit: created.unit },
  });
  return created;
}

export interface UpdatePolicyInput {
  annualAllotment?: number;
  carryOverDays?: number;
  carryOverExpiresOn?: string | null;
  negativeAllowed?: boolean;
  probationDays?: number;
  requiresApproval?: boolean | null;
  requiresAttachment?: boolean | null;
  maxBalance?: number | null;
}

export async function updatePolicyForAdmin(user: SessionUser, policyId: string, input: UpdatePolicyInput) {
  requireHr(user);
  if (input.carryOverExpiresOn) {
    const [month, day] = input.carryOverExpiresOn.split("-").map(Number);
    if (
      !/^\d{2}-\d{2}$/.test(input.carryOverExpiresOn) ||
      !month ||
      !day ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      throw new LeaveError("Carry-over expiry must be MM-DD (e.g. 03-31).");
    }
  }
  const policy = await prisma.leavePolicy.findFirst({
    where: { id: policyId, companyId: user.companyId },
  });
  if (!policy) throw new LeaveError("Policy not found.");
  const before = {
    annualAllotment: policy.annualAllotment,
    carryOverDays: policy.carryOverDays,
    carryOverExpiresOn: policy.carryOverExpiresOn,
    negativeAllowed: policy.negativeAllowed,
    probationDays: policy.probationDays,
  };
  const updated = await prisma.leavePolicy.update({
    where: { id: policyId },
    data: {
      annualAllotment: input.annualAllotment ?? policy.annualAllotment,
      carryOverDays: input.carryOverDays ?? policy.carryOverDays,
      carryOverExpiresOn:
        input.carryOverExpiresOn === undefined ? policy.carryOverExpiresOn : input.carryOverExpiresOn,
      negativeAllowed: input.negativeAllowed ?? policy.negativeAllowed,
      probationDays: input.probationDays ?? policy.probationDays,
      requiresApproval:
        input.requiresApproval === undefined ? policy.requiresApproval : input.requiresApproval,
      requiresAttachment:
        input.requiresAttachment === undefined ? policy.requiresAttachment : input.requiresAttachment,
      maxBalance: input.maxBalance === undefined ? policy.maxBalance : input.maxBalance,
    },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "leavePolicy.update",
    entityType: "LeavePolicy",
    entityId: policyId,
    entityName: policy.name,
    before,
    after: {
      annualAllotment: updated.annualAllotment,
      carryOverDays: updated.carryOverDays,
      carryOverExpiresOn: updated.carryOverExpiresOn,
      negativeAllowed: updated.negativeAllowed,
      probationDays: updated.probationDays,
    },
  });
  return updated;
}

/* ----------------------------- Leave-type lifecycle ----------------------- */

async function leaveTypeForAdmin(user: SessionUser, leaveTypeId: string) {
  const target = await prisma.leaveType.findFirst({
    where: { id: leaveTypeId, companyId: user.companyId },
  });
  if (!target) throw new LeaveError("Leave type not found.");
  return target;
}

/** Hide a leave type from new requests and active policy config; history intact. */
export async function archiveLeaveTypeForAdmin(user: SessionUser, leaveTypeId: string) {
  requireHr(user);
  const target = await leaveTypeForAdmin(user, leaveTypeId);
  if (target.isArchived) return target;
  const updated = await prisma.leaveType.update({
    where: { id: leaveTypeId },
    data: { isArchived: true },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "leaveType.archive",
    entityType: "LeaveType",
    entityId: leaveTypeId,
    entityName: target.name,
    before: { isArchived: false },
    after: { isArchived: true },
  });
  return updated;
}

/** Bring an archived leave type back into active use. */
export async function reactivateLeaveTypeForAdmin(user: SessionUser, leaveTypeId: string) {
  requireHr(user);
  const target = await leaveTypeForAdmin(user, leaveTypeId);
  if (!target.isArchived) return target;
  const updated = await prisma.leaveType.update({
    where: { id: leaveTypeId },
    data: { isArchived: false },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "leaveType.reactivate",
    entityType: "LeaveType",
    entityId: leaveTypeId,
    entityName: target.name,
    before: { isArchived: true },
    after: { isArchived: false },
  });
  return updated;
}

/**
 * Permanently deletes a leave type — only when it has never been used.
 * Any history (requests, balances) blocks deletion; those must be archived.
 */
export async function deleteLeaveTypeForAdmin(user: SessionUser, leaveTypeId: string) {
  requireHr(user);
  const target = await leaveTypeForAdmin(user, leaveTypeId);
  const [requests, balances] = await Promise.all([
    prisma.leaveRequest.count({ where: { leaveTypeId } }),
    prisma.leaveBalance.count({ where: { leaveTypeId } }),
  ]);
  if (requests > 0 || balances > 0) {
    throw new LeaveError(
      "Can't permanently delete a leave type that's been used — archive it instead.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.approvalRule.updateMany({
      where: { companyId: user.companyId, leaveTypeId },
      data: { leaveTypeId: null },
    });
    await tx.leaveType.delete({ where: { id: leaveTypeId } });
    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "leaveType.delete",
      entityType: "LeaveType",
      entityId: leaveTypeId,
      entityName: target.name,
      before: { name: target.name },
    });
  });
}

/* -------------------------------- Balances ------------------------------- */

export interface BalanceRow {
  id: string;
  userName: string;
  userEmail: string;
  leaveType: string;
  periodStart: string;
  periodEnd: string;
  accrued: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
}

export async function listBalancesForAdmin(
  user: SessionUser,
  opts: { userId?: string; leaveTypeId?: string } = {},
): Promise<BalanceRow[]> {
  requireHr(user);
  await syncCurrentAccruals(prisma, user.companyId!);
  const rows = await prisma.leaveBalance.findMany({
    where: {
      companyId: user.companyId,
      userId: opts.userId,
      leaveTypeId: opts.leaveTypeId,
    },
    include: {
      user: { select: { name: true, email: true } },
      leaveType: { select: { name: true } },
    },
    orderBy: [{ periodStart: "desc" }, { user: { name: "asc" } }],
  });
  return rows.map((b: (typeof rows)[number]) => ({
    id: b.id,
    userName: b.user.name,
    userEmail: b.user.email,
    leaveType: b.leaveType.name,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    accrued: b.accrued,
    carriedOver: b.carriedOver,
    adjustment: b.adjustment,
    used: b.used,
    pending: b.pending,
    available: b.accrued + b.carriedOver + b.adjustment - b.used - b.pending,
  }));
}

/** Adjust a user's balance (positive grants, negative takes back). Audited + notified. */
export async function adjustBalanceForAdmin(
  user: SessionUser,
  input: { userId: string; leaveTypeId: string; delta: number; reason: string; periodStart?: string },
) {
  requireHr(user);
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new LeaveError("Adjustment must be a non-zero number.");
  }
  const balance = await prisma.leaveBalance.findFirst({
    where: {
      companyId: user.companyId,
      userId: input.userId,
      leaveTypeId: input.leaveTypeId,
      ...(input.periodStart ? { periodStart: input.periodStart } : {}),
    },
    include: { user: { select: { name: true } }, leaveType: { select: { name: true } } },
    orderBy: { periodStart: "desc" },
  });
  if (!balance) throw new LeaveError("No balance row found for this user and leave type.");
  const available = balance.accrued + balance.carriedOver + balance.adjustment - balance.used - balance.pending;
  if (input.delta < 0 && available + input.delta < -0.001) {
    throw new LeaveError(
      `Adjustment would take the balance below zero (currently ${available} day${available === 1 ? "" : "s"}).`,
      "adjustmentBelowZero",
      { available },
    );
  }

  const outboxIds: string[] = [];
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.leaveBalance.update({
      where: { id: balance.id },
      data: { adjustment: { increment: input.delta } },
    });
    await tx.notification.create({
      data: {
        userId: balance.userId,
        type: "balance.adjust",
        title: input.delta > 0 ? "Leave days added" : "Leave days removed",
        body: `${input.delta > 0 ? "+" : ""}${input.delta} ${balance.leaveType.name} day${Math.abs(input.delta) === 1 ? "" : "s"}${input.reason ? ` — ${input.reason}` : ""}.`,
        entityType: "LeaveBalance",
        entityId: balance.id,
      },
    });
    const messageId = await enqueueOutbox(tx, {
      companyId: user.companyId!,
      userId: balance.userId,
      templateType: "balance.adjust",
      data: {
        delta: input.delta,
        leaveType: balance.leaveType.name,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        available: available + input.delta,
        reason: input.reason,
      },
    });
    if (messageId) outboxIds.push(messageId);
    return result;
  });
  await enqueueEmails(outboxIds);
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "balance.adjust",
    entityType: "LeaveBalance",
    entityId: balance.id,
    entityName: balance.user.name,
    employeeId: balance.userId,
    before: { adjustment: balance.adjustment },
    after: { adjustment: updated.adjustment },
    metadata: { delta: input.delta, reason: input.reason, leaveType: balance.leaveType.name },
  });
  return updated;
}

/* ------------------------------- Settings -------------------------------- */

export async function updateCompanySettingsForAdmin(
  user: SessionUser,
  input: { countWeekendsWithinSpan: boolean; extendWeekendAfterFriday: boolean },
) {
  requireHr(user);
  const before = await prisma.company.findUniqueOrThrow({
    where: { id: user.companyId! },
    select: { countWeekendsWithinSpan: true, extendWeekendAfterFriday: true },
  });
  const updated = await prisma.company.update({
    where: { id: user.companyId! },
    data: {
      countWeekendsWithinSpan: input.countWeekendsWithinSpan,
      extendWeekendAfterFriday: input.extendWeekendAfterFriday,
    },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "company.settings.update",
    entityType: "Company",
    entityId: user.companyId!,
    before,
    after: {
      countWeekendsWithinSpan: updated.countWeekendsWithinSpan,
      extendWeekendAfterFriday: updated.extendWeekendAfterFriday,
    },
  });
  return updated;
}
