import bcrypt from "bcryptjs";
import { prisma, type Role, type UserStatus } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";
import { audit, LeaveError } from "@/lib/services/leave";
import { enqueueOutbox } from "@/lib/emails";
import { enqueueEmails } from "@/lib/queue";
import { canGrantRole, canManageUsers } from "@/lib/permissions";

export { LeaveError };

export function requireHr(user: SessionUser): void {
  if (!canManageUsers(user)) {
    throw new LeaveError("HR access required.");
  }
}

/* ------------------------------- Overview -------------------------------- */

export async function adminStats(user: SessionUser) {
  requireHr(user);
  const companyId = user.companyId!;
  const today = new Date().toISOString().slice(0, 10);
  const [activeUsers, pendingRequests, departments, leaveTypes, delegations, balances, upcoming] =
    await Promise.all([
      prisma.user.count({ where: { companyId, status: "ACTIVE" } }),
      prisma.leaveRequest.count({ where: { companyId, status: "PENDING" } }),
      prisma.department.count({ where: { companyId } }),
      prisma.leaveType.count({ where: { companyId } }),
      prisma.approvalDelegation.count({ where: { companyId, active: true } }),
      prisma.leaveBalance.findMany({
        where: { companyId, periodStart: { lte: today }, periodEnd: { gte: today } },
        include: { user: { select: { name: true } }, leaveType: { select: { name: true } } },
      }),
      prisma.leaveRequest.count({
        where: {
          companyId,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { gte: today },
        },
      }),
    ]);
  const available = balances.reduce(
    (s: number, b: (typeof balances)[number]) => s + (b.accrued + b.carriedOver + b.adjustment - b.used - b.pending),
    0,
  );
  return { activeUsers, pendingRequests, departments, leaveTypes, delegations, available, upcoming };
}

/* --------------------------------- Users --------------------------------- */

export async function listUsersForAdmin(user: SessionUser) {
  requireHr(user);
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
    const vacation = u.balances.find((b: (typeof u.balances)[number]) => b.leaveType.name === "Vacation");
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

  const passwordHash = await bcrypt.hash(input.password, 10);
  const created = await prisma.user.create({
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
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "user.create",
    entityType: "User",
    entityId: created.id,
    after: { email, role: input.role, departmentId: input.departmentId },
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
    before: { name: target.name },
    after: { name: updated.name },
  });
  return updated;
}

/* ------------------------- Leave types & policies ------------------------ */

export async function listLeaveTypesForAdmin(user: SessionUser) {
  requireHr(user);
  return prisma.leaveType.findMany({
    where: { companyId: user.companyId },
    include: { policies: true },
    orderBy: { sortOrder: "asc" },
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
    before,
    after: {
      annualAllotment: updated.annualAllotment,
      carryOverDays: updated.carryOverDays,
      negativeAllowed: updated.negativeAllowed,
      probationDays: updated.probationDays,
    },
  });
  return updated;
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
    before: { adjustment: balance.adjustment },
    after: { adjustment: updated.adjustment },
    metadata: { delta: input.delta, reason: input.reason },
  });
  return updated;
}
