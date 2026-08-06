import { prisma, Prisma, type DayPart, type LeaveRequestStatus } from "@timeoff/db";
import {
  addDaysISO,
  availableBalance,
  computeLeaveDays,
  isValidISODate,
  LeaveSpanError,
  leaveYearRange,
  prorateAllotment,
  spansOverlap,
  carryOverDeadline,
} from "@timeoff/domain";
import type { SessionUser } from "@/lib/session";
import { attachStagedAttachments, AttachmentError } from "@/lib/services/attachments";
import { enqueueOutbox } from "@/lib/emails";
import { enqueueEmails } from "@/lib/queue";
import {
  canApprove,
  PEOPLE_OPS_ROLES,
  resolveDepartmentId,
} from "@/lib/permissions";

/** User-facing validation error that maps to a friendly message. */
export class LeaveError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly values?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "LeaveError";
  }
}

/** Non-expiring balance base: accrued + adjustment (carried-over days expire). */
function baseNonExpiringDays(balance: BalanceResolution): number {
  return balance.existing
    ? balance.row.accrued + balance.row.adjustment
    : balance.plan.accrued;
}

export interface CreateLeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startDayPart?: DayPart;
  endDayPart?: DayPart;
  reason?: string;
  /** Staged attachment uploads to bind to the new request (I4). */
  attachmentIds?: string[];
}

/** Accepts either the top-level client or an interactive-transaction client. */
type Db = Prisma.TransactionClient;

/** Materializes holiday dates that fall inside [start, end], expanding recurring ones. */
async function holidaysForRange(
  db: Db,
  companyId: string,
  countryCode: string,
  start: string,
  end: string,
): Promise<Set<string>> {
  const rows = await db.holiday.findMany({ where: { companyId, countryCode } });
  return materializeHolidays(rows, start, end);
}

/** Company-wide holidays (any country) inside [start, end]. Used by the team calendar. */
export async function companyHolidays(
  db: Db,
  companyId: string,
  start: string,
  end: string,
): Promise<Set<string>> {
  const rows = await db.holiday.findMany({ where: { companyId } });
  return materializeHolidays(rows, start, end);
}

function materializeHolidays(
  rows: Array<{ date: string; isRecurring: boolean }>,
  start: string,
  end: string,
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.isRecurring) {
      const startYear = Number(start.slice(0, 4));
      const endYear = Number(end.slice(0, 4));
      for (let year = startYear; year <= endYear; year++) {
        const instance = `${year}-${row.date.slice(5)}`;
        if (instance >= start && instance <= end) set.add(instance);
      }
    } else if (row.date >= start && row.date <= end) {
      set.add(row.date);
    }
  }
  return set;
}

/** Effective LeavePolicy for a user + leave type (department-specific wins). */
async function getPolicy(
  db: Db,
  companyId: string,
  leaveTypeId: string,
  departmentId: string,
  countryCode: string,
) {
  const policies = await db.leavePolicy.findMany({
    where: {
      companyId,
      leaveTypeId,
      AND: [
        { OR: [{ departmentId: null }, { departmentId }] },
        { OR: [{ countryCode: null }, { countryCode }] },
      ],
    },
  });
  return (
    policies.find((p) => p.departmentId === departmentId) ??
    policies.find((p) => p.departmentId === null) ??
    null
  );
}

/** The current leave-year balance row for a user/type, if one exists. */
async function currentBalance(
  db: Db,
  userId: string,
  leaveTypeId: string,
  onDate: string,
) {
  return db.leaveBalance.findFirst({
    where: {
      userId,
      leaveTypeId,
      periodStart: { lte: onDate },
      periodEnd: { gte: onDate },
    },
    orderBy: { periodStart: "desc" },
  });
}

type BalanceResolution =
  | {
      existing: true;
      row: NonNullable<Awaited<ReturnType<typeof currentBalance>>>;
      available: number;
    }
  | {
      existing: false;
      plan: { periodStart: string; periodEnd: string; accrued: number; carriedOver: number };
      available: number;
    };

/**
 * The balance to enforce a request against. Uses the row covering the request
 * start date; if the leave-year has no row yet, plans one from the policy's
 * annual allotment (prorated for the hire date / part-time contract) without
 * persisting until the request itself succeeds.
 *
 * Carry-over: when planning a *new* leave year that directly follows an
 * existing row, up to `carryOverDays` of the previous year's leftover is rolled
 * into the plan (L4). Days are carried at most once — never cascading.
 */
async function resolveBalanceForDate(
  db: Db,
  company: { id: string; fiscalYearStartMonth: number },
  user: { id: string; companyId: string; employmentStartDate: string; employmentType: string },
  leaveTypeId: string,
  policy: { annualAllotment: number; carryOverDays: number } | null,
  onDate: string,
): Promise<BalanceResolution | null> {
  const existing = await currentBalance(db, user.id, leaveTypeId, onDate);
  if (existing) {
    return { existing: true, row: existing, available: availableBalance(existing) };
  }
  if (!policy || policy.annualAllotment <= 0) return null;

  const year = Number(onDate.slice(0, 4));
  const month = Number(onDate.slice(5, 7));
  const fiscal = company.fiscalYearStartMonth;
  const startYear = fiscal > 1 && month < fiscal ? year - 1 : year;
  const { start, end } = leaveYearRange(fiscal, startYear);
  const ratio = user.employmentType === "PART_TIME" ? 0.5 : 1;
  const accrued = prorateAllotment({
    annualAllotment: policy.annualAllotment,
    employmentStartDate: user.employmentStartDate,
    periodStart: start,
    periodEnd: end,
    fullTimeRatio: ratio,
  });

  let carriedOver = 0;
  if (policy.carryOverDays > 0) {
    const prior = await currentBalance(db, user.id, leaveTypeId, addDaysISO(start, -1));
    if (prior) {
      carriedOver = Math.min(policy.carryOverDays, Math.max(0, availableBalance(prior)));
    }
  }

  return {
    existing: false,
    plan: { periodStart: start, periodEnd: end, accrued, carriedOver },
    available: accrued + carriedOver,
  };
}

interface ApproverContext {
  managerId: string | null;
  managersManagerId: string | null;
  departmentId: string;
  companyId: string;
}

/** Active delegation for an approver on a given date, if any. */
async function activeDelegateFor(
  db: Db,
  approverId: string,
  onDate: string,
): Promise<string | null> {
  const rows = await db.approvalDelegation.findMany({
    where: { userId: approverId, active: true },
    orderBy: { createdAt: "desc" },
  });
  const current = rows.find(
    (d) => (!d.startsOn || d.startsOn <= onDate) && (!d.endsOn || d.endsOn >= onDate),
  );
  return current?.delegateId ?? null;
}

/**
 * Resolves the next approver for a request: the lowest-level matching active
 * rule above `afterLevel` (0 = not yet approved anywhere). Delegation for the
 * resolved approver is applied at decision time. Returns null when the chain
 * is exhausted (the request is then final).
 */
async function resolveApprover(
  db: Db,
  ctx: ApproverContext,
  leaveTypeId: string,
  afterLevel: number,
  onDate: string,
): Promise<{ approverId: string; level: number } | null> {
  const rules = await db.approvalRule.findMany({
    where: {
      companyId: ctx.companyId,
      active: true,
      level: { gt: afterLevel },
      OR: [{ departmentId: null }, { departmentId: ctx.departmentId }],
    },
    orderBy: { level: "asc" },
  });

  for (const rule of rules) {
    if (rule.leaveTypeId && rule.leaveTypeId !== leaveTypeId) continue;
    let approverId: string | null = null;
    switch (rule.kind) {
      case "MANAGER":
        approverId = ctx.managerId;
        break;
      case "MANAGERS_MANAGER":
        approverId = ctx.managersManagerId;
        break;
      case "HR": {
        const hr = await db.user.findFirst({
          where: {
            companyId: ctx.companyId,
            status: "ACTIVE",
            role: { in: ["HR", "SUPER_ADMIN"] },
          },
          orderBy: { role: "asc" },
        });
        approverId = hr?.id ?? null;
        break;
      }
      case "SPECIFIC_USER":
        approverId = rule.specificUserId;
        break;
    }
    if (!approverId) continue;
    const delegateId = await activeDelegateFor(db, approverId, onDate);
    return { approverId: delegateId ?? approverId, level: rule.level };
  }
  return null;
}

export async function audit(
  db: Db,
  input: {
    companyId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (input.before as object),
      after: input.after === undefined ? undefined : (input.after as object),
      metadata: input.metadata === undefined ? undefined : (input.metadata as object),
    },
  });
}

/**
 * Creates a leave request with full validation:
 *  - span is valid and contains working days (weekends/holidays excluded)
 *  - does not overlap the user's own non-final requests (half-day aware)
 *  - balance sufficiency (unless the policy allows a bounded negative)
 *  - probation window respected for paid leave
 * Auto-approves types flagged `requiresApproval: false` (e.g. sick leave).
 */
export async function createLeaveRequest(user: SessionUser, input: CreateLeaveInput) {
  const { leaveTypeId, startDate, endDate, reason } = input;
  const startDayPart = input.startDayPart ?? "FULL";
  const endDayPart = input.endDayPart ?? "FULL";

  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    throw new LeaveError("Pick valid start and end dates.");
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || dbUser.status !== "ACTIVE") {
    throw new LeaveError("Your account is not active.");
  }

  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!leaveType || leaveType.companyId !== user.companyId) {
    throw new LeaveError("Unknown leave type.");
  }

  const policy = await getPolicy(
    prisma,
    user.companyId!,
    leaveTypeId,
    dbUser.departmentId,
    dbUser.countryCode,
  );

  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });

  let computed;
  try {
    const holidays = await holidaysForRange(
      prisma,
      user.companyId!,
      dbUser.countryCode,
      startDate,
      endDate,
    );
    computed = computeLeaveDays(
      { startDate, endDate, startDayPart, endDayPart },
      { holidays },
    );
  } catch (error) {
    if (error instanceof LeaveSpanError) throw new LeaveError(error.message);
    throw error;
  }
  const { days, totalDays } = computed;

  const conflicts = await prisma.leaveRequest.findMany({
    where: {
      userId: user.id,
      status: { in: ["PENDING", "APPROVED"] },
    },
  });
  for (const other of conflicts) {
    const holidays = await holidaysForRange(
      prisma,
      user.companyId!,
      dbUser.countryCode,
      startDate,
      endDate,
    );
    const overlap = spansOverlap(
      { startDate, endDate, startDayPart, endDayPart },
      { startDate: other.startDate, endDate: other.endDate, startDayPart: other.startDayPart, endDayPart: other.endDayPart },
      { holidays },
    );
    if (overlap.overlappingDays > 0) {
      throw new LeaveError("This overlaps a request you already submitted.");
    }
  }

  const balance = await resolveBalanceForDate(
    prisma,
    company,
    dbUser,
    leaveTypeId,
    policy,
    startDate,
  );
  if (balance && totalDays > balance.available) {
    const shortage = totalDays - balance.available;
    const negativeAllowed = policy?.negativeAllowed && shortage <= (policy.maxNegative ?? 0);
    if (!negativeAllowed) {
      throw new LeaveError(
        `Insufficient balance: ${balance.available} day${balance.available === 1 ? "" : "s"} available, ${totalDays} requested.`,
        "insufficientBalance",
        { available: balance.available, requested: totalDays },
      );
    }
  }

  // L4: carried-over days expire on the policy deadline (MM-DD) in the year
  // they are granted into. A request that consumes carried-over days (i.e. it
  // needs more than accrued + adjustment) must end on or before that date.
  if (balance && policy?.carryOverExpiresOn && totalDays > baseNonExpiringDays(balance) + 1e-6) {
    const year = balance.existing
      ? balance.row.periodStart.slice(0, 4)
      : balance.plan.periodStart.slice(0, 4);
    const expiry = carryOverDeadline(year, policy.carryOverExpiresOn);
    if (endDate > expiry) {
      throw new LeaveError(
        `Carried-over days must be used by ${expiry} — end the request on or before that date.`,
        "carriedOverExpiry",
        { expiry },
      );
    }
  }

  if (policy?.probationDays && policy.probationDays > 0 && leaveType.isPaid) {
    const probationEnd = addDaysISO(dbUser.employmentStartDate, policy.probationDays);
    if (startDate < probationEnd) {
      throw new LeaveError(
        `Paid leave starts before your probation ends on ${probationEnd}.`,
        "probation",
        { date: probationEnd },
      );
    }
  }

  const approver = await resolveApprover(
    prisma,
    {
      managerId: dbUser.managerId,
      managersManagerId: dbUser.managerId
        ? (await prisma.user.findUnique({ where: { id: dbUser.managerId } }))?.managerId ?? null
        : null,
      departmentId: dbUser.departmentId,
      companyId: dbUser.companyId,
    },
    leaveTypeId,
    0,
    startDate,
  );

  const requiresApproval = policy?.requiresApproval ?? leaveType.requiresApproval;
  const status: LeaveRequestStatus = requiresApproval ? "PENDING" : "APPROVED";

  const attachmentIds = input.attachmentIds ?? [];
  const requiresAttachment = Boolean(leaveType.requiresAttachment || policy?.requiresAttachment);
  if (requiresAttachment && attachmentIds.length === 0) {
    throw new LeaveError("This leave type requires an attachment (e.g. a medical certificate).");
  }

  const outboxIds: string[] = [];
  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        companyId: user.companyId!,
        userId: user.id,
        leaveTypeId,
        startDate,
        endDate,
        startDayPart,
        endDayPart,
        totalDays,
        reason: reason?.trim() ? reason.trim() : null,
        status,
        approvedById: status === "APPROVED" ? user.id : undefined,
        approvedAt: status === "APPROVED" ? new Date() : undefined,
        days: { create: days.map((day) => ({ date: day.date, dayPart: day.dayPart })) },
      },
    });
    if (attachmentIds.length > 0) {
      try {
        await attachStagedAttachments(tx, user.id, user.companyId!, created.id, attachmentIds);
      } catch (error) {
        if (error instanceof AttachmentError) throw new LeaveError(error.message);
        throw error;
      }
    }

    if (balance) {
      let balanceId: string;
      if (balance.existing) {
        balanceId = balance.row.id;
      } else {
        const createdBalance = await tx.leaveBalance.create({
          data: {
            companyId: user.companyId!,
            userId: user.id,
            leaveTypeId,
            periodStart: balance.plan.periodStart,
            periodEnd: balance.plan.periodEnd,
            accrued: balance.plan.accrued,
            carriedOver: balance.plan.carriedOver,
            adjustment: 0,
            used: 0,
            pending: 0,
          },
        });
        balanceId = createdBalance.id;
      }
      await tx.leaveBalance.update({
        where: { id: balanceId },
        data:
          status === "APPROVED"
            ? { used: { increment: totalDays } }
            : { pending: { increment: totalDays } },
      });
    }

    if (approver && status === "PENDING") {
      await tx.notification.create({
        data: {
          userId: approver.approverId,
          type: "request.submitted",
          title: `Leave request from ${dbUser.name}`,
          body: `${startDate}${endDate !== startDate ? ` – ${endDate}` : ""} · ${totalDays} day${totalDays === 1 ? "" : "s"} · ${leaveType.name}`,
          entityType: "LeaveRequest",
          entityId: created.id,
        },
      });
      const messageId = await enqueueOutbox(tx, {
        companyId: user.companyId!,
        userId: approver.approverId,
        templateType: "request.submitted",
        data: {
          requesterName: dbUser.name,
          leaveType: leaveType.name,
          startDate,
          endDate,
          days: totalDays,
          reason: reason?.trim() || null,
          requestId: created.id,
        },
      });
      if (messageId) outboxIds.push(messageId);
    }

    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "leaveRequest.create",
      entityType: "LeaveRequest",
      entityId: created.id,
      after: { status, totalDays, startDate, endDate },
    });

    return created;
  });

  await enqueueEmails(outboxIds);

  return request;
}

/** Owner cancels a request. PENDING frees pending days; APPROVED frees used days. */
export async function cancelLeaveRequest(user: SessionUser, requestId: string, reason?: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== user.id) {
    throw new LeaveError("Request not found.");
  }
  if (request.status !== "PENDING" && request.status !== "APPROVED") {
    throw new LeaveError("This request can no longer be cancelled.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        cancelledById: user.id,
        cancelReason: reason?.trim() ? reason.trim() : null,
      },
    });

    const balance = await currentBalance(tx, user.id, request.leaveTypeId, request.startDate);
    if (balance) {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data:
          request.status === "PENDING"
            ? { pending: { decrement: request.totalDays } }
            : { used: { decrement: request.totalDays } },
      });
    }

    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "leaveRequest.cancel",
      entityType: "LeaveRequest",
      entityId: requestId,
      before: { status: request.status },
      after: { status: "CANCELLED" },
    });
  });

  return { ok: true as const };
}

/**
 * Who the request expects to decide right now: the effective approver at
 * `currentApprovalLevel + 1`, with delegation applied. Null when the chain is
 * exhausted (request is already final at this level).
 */
async function expectedApprover(
  request: NonNullable<Awaited<ReturnType<typeof loadRequestForDecision>>>,
): Promise<{ approverId: string; level: number } | null> {
  return resolveApprover(
    prisma,
    {
      managerId: request.user.managerId,
      managersManagerId: request.user.manager?.managerId ?? null,
      departmentId: request.user.departmentId,
      companyId: request.user.companyId,
    },
    request.leaveTypeId,
    request.currentApprovalLevel,
    request.startDate,
  );
}

/**
 * Whether `actor` may decide on `request` (effective approver, or
 * HR/ADMIN/SUPER_ADMIN override). EMPLOYEE and EXECUTIVE can never decide;
 * MANAGER is limited to their own department.
 */
async function canDecide(
  request: NonNullable<Awaited<ReturnType<typeof loadRequestForDecision>>>,
  actor: SessionUser,
): Promise<boolean> {
  if (actor.role === "SUPER_ADMIN" || actor.role === "HR" || actor.role === "ADMIN") return true;
  if (!canApprove(actor)) return false;
  if (request.delegateToId === actor.id) return true;
  const approver = await expectedApprover(request);
  if (approver?.approverId !== actor.id) return false;
  if (actor.role === "MANAGER") {
    const departmentId = await resolveDepartmentId(actor);
    return Boolean(departmentId && departmentId === request.user.departmentId);
  }
  return true;
}

function loadRequestForDecision(requestId: string) {
  return prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { user: { include: { manager: true } }, leaveType: true },
  });
}

/** Whether `user` may currently decide on a request (for detail-page actions). */
export async function canUserDecide(user: SessionUser, requestId: string): Promise<boolean> {
  const request = await loadRequestForDecision(requestId);
  if (!request || request.companyId !== user.companyId) return false;
  if (request.status !== "PENDING") return false;
  return canDecide(request, user);
}

export async function decideLeaveRequest(
  user: SessionUser,
  requestId: string,
  decision: { outcome: "APPROVED" } | { outcome: "REJECTED"; reason?: string },
) {
  const request = await loadRequestForDecision(requestId);
  if (!request) throw new LeaveError("Request not found.");
  if (request.companyId !== user.companyId) throw new LeaveError("Request not found.");
  if (!(await canDecide(request, user))) {
    throw new LeaveError("You are not the approver for this request.");
  }
  if (request.status !== "PENDING") {
    throw new LeaveError("This request has already been processed.");
  }

  const outcome = decision.outcome;
  const isHrRole = user.role === "HR" || user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  const expected = await expectedApprover(request);
  const isExpectedApprover = expected?.approverId === user.id || request.delegateToId === user.id;
  // HR/SUPER_ADMIN decide as override only when they are not the chain's expected approver;
  // when they are (e.g. the HR review step), the request advances normally.
  const isHrOverride = isHrRole && !isExpectedApprover;
  const reason = outcome === "REJECTED" ? (decision.reason?.trim() || null) : null;

  const outboxIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    let nextStatus: LeaveRequestStatus = outcome;
    let nextLevel = request.currentApprovalLevel;

    if (outcome === "APPROVED") {
      const approvedAtLevel = isHrOverride ? request.currentApprovalLevel + 1 : expected?.level ?? request.currentApprovalLevel + 1;
      await tx.approvalStep.create({
        data: {
          leaveRequestId: requestId,
          approverId: user.id,
          level: approvedAtLevel,
          action: "APPROVED",
          comment: null,
        },
      });
      if (!isHrOverride) {
        nextLevel = approvedAtLevel;
        const next = await resolveApprover(
          tx,
          {
            managerId: request.user.managerId,
            managersManagerId: request.user.manager?.managerId ?? null,
            departmentId: request.user.departmentId,
            companyId: request.user.companyId,
          },
          request.leaveTypeId,
          nextLevel,
          request.startDate,
        );
        if (next) {
          nextStatus = "PENDING";
          await tx.notification.create({
            data: {
              userId: next.approverId,
              type: "request.submitted",
              title: `Leave request from ${request.user.name}`,
              body: `${request.startDate}${request.endDate !== request.startDate ? ` – ${request.endDate}` : ""} · ${request.totalDays} day${request.totalDays === 1 ? "" : "s"} · ${request.leaveType.name} (level ${next.level})`,
              entityType: "LeaveRequest",
              entityId: requestId,
            },
          });
          const messageId = await enqueueOutbox(tx, {
            companyId: request.companyId,
            userId: next.approverId,
            templateType: "request.submitted",
            data: {
              requesterName: request.user.name,
              leaveType: request.leaveType.name,
              startDate: request.startDate,
              endDate: request.endDate,
              days: request.totalDays,
              reason: request.reason,
              requestId,
              level: next.level,
            },
          });
          if (messageId) outboxIds.push(messageId);
        }
      }
    } else {
      await tx.approvalStep.create({
        data: {
          leaveRequestId: requestId,
          approverId: user.id,
          level: request.currentApprovalLevel + 1,
          action: "REJECTED",
          comment: reason,
        },
      });
    }

    await tx.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus,
        currentApprovalLevel: nextLevel,
        approvedById: nextStatus === "APPROVED" ? user.id : undefined,
        approvedAt: nextStatus === "APPROVED" ? new Date() : undefined,
        effectiveApproverId: nextStatus === "APPROVED" ? user.id : undefined,
        rejectionReason: reason,
      },
    });

    if (nextStatus !== "PENDING") {
      const balance = await currentBalance(tx, request.userId, request.leaveTypeId, request.startDate);
      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data:
            nextStatus === "APPROVED"
              ? { pending: { decrement: request.totalDays }, used: { increment: request.totalDays } }
              : { pending: { decrement: request.totalDays } },
        });
      }
    }

    if (nextStatus === "PENDING") {
      await tx.notification.create({
        data: {
          userId: request.userId,
          type: "request.approved",
          title: "Approval step complete",
          body: `Your ${request.leaveType.name} from ${request.startDate} moved to the next approval level.`,
          entityType: "LeaveRequest",
          entityId: requestId,
        },
      });
      const messageId = await enqueueOutbox(tx, {
        companyId: request.companyId,
        userId: request.userId,
        templateType: "approval.step",
        data: {
          leaveType: request.leaveType.name,
          startDate: request.startDate,
          endDate: request.endDate,
          days: request.totalDays,
          level: nextLevel,
        },
      });
      if (messageId) outboxIds.push(messageId);
    } else {
      await tx.notification.create({
        data: {
          userId: request.userId,
          type: outcome === "APPROVED" ? "request.approved" : "request.rejected",
          title: outcome === "APPROVED" ? "Leave approved" : "Leave request declined",
          body:
            outcome === "APPROVED"
              ? `Your ${request.leaveType.name} from ${request.startDate} was approved.`
              : `Your ${request.leaveType.name} from ${request.startDate} was declined${reason ? `: ${reason}` : "."}`,
          entityType: "LeaveRequest",
          entityId: requestId,
        },
      });
      const messageId = await enqueueOutbox(tx, {
        companyId: request.companyId,
        userId: request.userId,
        templateType: outcome === "APPROVED" ? "request.approved" : "request.rejected",
        data:
          outcome === "APPROVED"
            ? {
                leaveType: request.leaveType.name,
                startDate: request.startDate,
                endDate: request.endDate,
                days: request.totalDays,
              }
            : {
                leaveType: request.leaveType.name,
                startDate: request.startDate,
                endDate: request.endDate,
                days: request.totalDays,
                reason,
              },
      });
      if (messageId) outboxIds.push(messageId);
    }

    await audit(tx, {
      companyId: request.companyId,
      actorId: user.id,
      action: outcome === "APPROVED" ? "leaveRequest.approve" : "leaveRequest.reject",
      entityType: "LeaveRequest",
      entityId: requestId,
      before: { status: "PENDING", level: request.currentApprovalLevel },
      after: { status: nextStatus, level: nextLevel },
    });
  });

  await enqueueEmails(outboxIds);

  return { ok: true as const };
}

/**
 * All PENDING requests the user can act on (effective approver, or HR/ADMIN
 * oversight). EMPLOYEE and EXECUTIVE never see a queue; MANAGER is scoped to
 * their own department.
 */
export async function listPendingForApproval(user: SessionUser) {
  const isPeopleOps = user.role === "HR" || user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  if (!canApprove(user)) return [];
  const departmentId = user.role === "MANAGER" ? await resolveDepartmentId(user) : null;
  const requests = await prisma.leaveRequest.findMany({
    where: {
      companyId: user.companyId,
      status: "PENDING",
      ...(departmentId ? { user: { departmentId } } : {}),
    },
    include: {
      user: { include: { manager: true, department: true } },
      leaveType: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const mine: typeof requests = [];
  for (const request of requests) {
    if (isPeopleOps) {
      mine.push(request);
      continue;
    }
    if (request.delegateToId === user.id) {
      mine.push(request);
      continue;
    }
    const approver = await expectedApprover(request);
    if (approver?.approverId === user.id) mine.push(request);
  }
  return mine;
}

export interface DelegationInput {
  delegateId: string;
  startsOn?: string;
  endsOn?: string;
}

/** Manager delegates their approval duties to a colleague, optionally date-bounded. */
export async function createDelegation(user: SessionUser, input: DelegationInput) {
  if (user.role !== "MANAGER" && !PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE")) {
    throw new LeaveError("Only approvers can delegate.");
  }
  if (input.delegateId === user.id) throw new LeaveError("Cannot delegate to yourself.");
  if (
    input.startsOn &&
    input.endsOn &&
    input.startsOn > input.endsOn
  ) {
    throw new LeaveError("Delegation start must be before its end.");
  }
  const delegate = await prisma.user.findFirst({
    where: { id: input.delegateId, companyId: user.companyId, status: "ACTIVE" },
  });
  if (!delegate) throw new LeaveError("Delegate not found in this company.");
  if (user.role === "MANAGER") {
    const departmentId = await resolveDepartmentId(user);
    if (departmentId && delegate.departmentId !== departmentId) {
      throw new LeaveError("Delegation target must be in your own department.");
    }
  }

  const created = await prisma.approvalDelegation.create({
    data: {
      companyId: user.companyId!,
      userId: user.id,
      delegateId: input.delegateId,
      startsOn: input.startsOn || null,
      endsOn: input.endsOn || null,
    },
  });

  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "approvalDelegation.create",
    entityType: "ApprovalDelegation",
    entityId: created.id,
    after: { delegateId: input.delegateId, startsOn: created.startsOn, endsOn: created.endsOn },
  });

  return created;
}

/** Deactivate a delegation (no-op if already inactive). */
export async function deactivateDelegation(user: SessionUser, delegationId: string) {
  const delegation = await prisma.approvalDelegation.findUnique({
    where: { id: delegationId },
  });
  if (!delegation || delegation.companyId !== user.companyId) {
    throw new LeaveError("Delegation not found.");
  }
  if (delegation.userId !== user.id && !PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE")) {
    throw new LeaveError("Only the delegation owner or HR can deactivate this.");
  }
  if (!delegation.active) return delegation;

  const updated = await prisma.approvalDelegation.update({
    where: { id: delegationId },
    data: { active: false },
  });
  await audit(prisma, {
    companyId: user.companyId,
    actorId: user.id,
    action: "approvalDelegation.deactivate",
    entityType: "ApprovalDelegation",
    entityId: delegationId,
    before: { active: true },
    after: { active: false },
  });
  return updated;
}

/** Delegations involving `user` as owner or delegate, newest first. */
export async function listDelegations(user: SessionUser) {
  return prisma.approvalDelegation.findMany({
    where: {
      companyId: user.companyId,
      OR: [{ userId: user.id }, { delegateId: user.id }],
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      delegate: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Active team members to pick as delegation target (managers: own department only). */
export async function listDelegationCandidates(user: SessionUser) {
  const departmentId = user.role === "MANAGER" ? await resolveDepartmentId(user) : null;
  return prisma.user.findMany({
    where: {
      companyId: user.companyId,
      status: "ACTIVE",
      id: { not: user.id },
      ...(departmentId ? { departmentId } : {}),
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
