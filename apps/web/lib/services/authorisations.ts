import { prisma, Prisma, type LeaveRequestStatus } from "@timeoff/db";
import {
  authorisationCarryOver,
  authorisationDurationHours,
  authorisationPeriod,
  authorisationTransition,
  availableAuthorisationHours,
  isValidAuthorisationPeriod,
  isValidISODate,
  monthlyAuthorisationAllowance,
  todayISO,
  validateAuthorisationHours,
  validateAuthorisationPolicy,
  validateAuthorisationTimeRange,
  type AuthorisationPolicyConfig,
} from "@timeoff/domain";
import type { SessionUser } from "@/lib/session";
import { canApprove, PEOPLE_OPS_ROLES, resolveDepartmentId } from "@/lib/permissions";
import { requireHr } from "@/lib/services/admin";
import { audit } from "@/lib/services/leave";

/**
 * User-facing validation error that maps to a friendly (localized) message.
 */
export class AuthorisationError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly values?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "AuthorisationError";
  }
}

/** Accepts either the top-level client or an interactive-transaction client. */
type Db = Prisma.TransactionClient;

export type AuthorisationPolicyRow = Prisma.AuthorisationPolicyGetPayload<Record<string, never>>;

/** The module is enabled and the policy row exists. */
export async function getAuthorisationPolicy(
  db: Db,
  companyId: string,
): Promise<AuthorisationPolicyRow | null> {
  return db.authorisationPolicy.findUnique({ where: { companyId } });
}

/** Throws unless the module is enabled; returns the policy otherwise. */
export async function requireAuthorisationPolicy(
  db: Db,
  companyId: string,
): Promise<AuthorisationPolicyRow> {
  const policy = await getAuthorisationPolicy(db, companyId);
  if (!policy || !policy.enabled) {
    throw new AuthorisationError(
      "Authorisations are not enabled for your company.",
      "authorisationsDisabled",
    );
  }
  return policy;
}

function policyErrorMessage(
  kind: NonNullable<ReturnType<typeof validateAuthorisationPolicy>>,
): AuthorisationError {
  switch (kind) {
    case "allowance":
      return new AuthorisationError("Monthly allowance must be a positive number.", "authorisationPolicyAllowance");
    case "minHours":
      return new AuthorisationError("Minimum request must be a positive number.", "authorisationPolicyMinHours");
    case "maxHoursBelowMin":
      return new AuthorisationError("Maximum request cannot be below the minimum.", "authorisationPolicyMaxHours");
    case "increment":
      return new AuthorisationError("Request increment must be a positive number.", "authorisationPolicyIncrement");
    case "maxCarryOver":
      return new AuthorisationError("Max carry-over cannot be negative.", "authorisationPolicyCarryOver");
  }
}

function hoursErrorMessage(
  kind: NonNullable<ReturnType<typeof validateAuthorisationHours>>,
  policy: AuthorisationPolicyRow,
): AuthorisationError {
  switch (kind) {
    case "notPositive":
      return new AuthorisationError("Hours must be a positive number.", "authorisationHoursNotPositive");
    case "belowMinimum":
      return new AuthorisationError(
        `The minimum request is ${policy.minRequestHours} hours.`,
        "authorisationBelowMinimum",
        { min: policy.minRequestHours },
      );
    case "aboveMaximum":
      return new AuthorisationError(
        `The maximum request is ${policy.maxRequestHours} hours.`,
        "authorisationAboveMaximum",
        { max: policy.maxRequestHours },
      );
    case "notIncrement":
      return new AuthorisationError(
        `Requests must be a multiple of ${policy.requestIncrementHours} hours.`,
        "authorisationNotIncrement",
        { increment: policy.requestIncrementHours },
      );
  }
}

function timeRangeErrorMessage(
  kind: NonNullable<ReturnType<typeof validateAuthorisationTimeRange>>,
): AuthorisationError {
  switch (kind) {
    case "invalidStartTime":
      return new AuthorisationError("Pick a valid start time.", "authorisationInvalidStartTime");
    case "invalidEndTime":
      return new AuthorisationError("Pick a valid end time.", "authorisationInvalidEndTime");
    case "endNotAfterStart":
      return new AuthorisationError("End time must be after start time.", "authorisationEndNotAfterStart");
  }
}

const nextPeriod = (period: string): string => {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};

/**
 * Ensures a monthly balance row exists for every period from the employee's
 * joining month through the current month. Idempotent by construction: existing
 * rows are returned untouched, so a second run produces the same numbers (a
 * month's allowance is granted exactly once — 4h stays 4h, never 8h).
 *
 * Each new row is created with:
 *  - `granted` = the month's allowance (prorated joining month when enabled);
 *  - `carriedOver` = the previous period's AVAILABLE hours, capped by the
 *    policy (0 unused => 0 carried). Computed once at creation time from the
 *    stored previous row, so later policy changes never rewrite the past.
 *
 * Scoped to `userId` when given. Returns the number of rows created.
 */
export async function syncAuthorisationPeriods(
  db: Db,
  policy: AuthorisationPolicyRow,
  userId?: string,
): Promise<number> {
  const current = authorisationPeriod(todayISO());
  if (!current) return 0;

  const users = await db.user.findMany({
    where: { companyId: policy.companyId, status: "ACTIVE", ...(userId ? { id: userId } : {}) },
    select: { id: true, employmentStartDate: true },
  });

  let created = 0;
  for (const user of users) {
    let period = authorisationPeriod(user.employmentStartDate);
    if (!period || period > current) period = current;

    let previous: Prisma.AuthorisationBalanceGetPayload<Record<string, never>> | null = null;
    while (period <= current) {
      const existing = await db.authorisationBalance.findUnique({
        where: { userId_period: { userId: user.id, period } },
      });
      if (existing) {
        previous = existing;
        period = nextPeriod(period);
        continue;
      }
      const row: Prisma.AuthorisationBalanceGetPayload<Record<string, never>> =
        await db.authorisationBalance.create({
          data: {
            companyId: policy.companyId,
            userId: user.id,
            period,
            granted: monthlyAuthorisationAllowance({
              monthlyAllowance: policy.monthlyAllowance,
              employmentStartDate: user.employmentStartDate,
              period,
              prorateFirstMonth: policy.prorateFirstMonth,
            }),
            carriedOver: previous
              ? authorisationCarryOver(availableAuthorisationHours(previous), {
                  carryOverEnabled: policy.carryOverEnabled,
                  maxCarryOverHours: policy.maxCarryOverHours,
                })
              : 0,
            adjustment: 0,
            used: 0,
            pending: 0,
          },
        });
      previous = row;
      created += 1;
      period = nextPeriod(period);
    }
  }
  return created;
}

/** The current monthly period's balance row for a user, after ensuring it exists. */
export async function authorisationBalanceFor(
  db: Db,
  policy: AuthorisationPolicyRow,
  userId: string,
  period = authorisationPeriod(todayISO()),
): Promise<Prisma.AuthorisationBalanceGetPayload<Record<string, never>> | null> {
  if (!isValidAuthorisationPeriod(period)) return null;
  await syncAuthorisationPeriods(db, policy, userId);
  return db.authorisationBalance.findUnique({ where: { userId_period: { userId, period } } });
}

/* ----------------------------- Admin policy ------------------------------ */

export interface AuthorisationPolicyInput extends AuthorisationPolicyConfig {
  enabled: boolean;
}

/** HR/Admin updates the company policy (create on first use; never deletes data). */
export async function updateAuthorisationPolicyForAdmin(
  user: SessionUser,
  input: AuthorisationPolicyInput,
): Promise<AuthorisationPolicyRow> {
  requireHr(user);
  const policyError = validateAuthorisationPolicy(input);
  if (policyError) throw policyErrorMessage(policyError);

  const before = await prisma.authorisationPolicy.findUnique({
    where: { companyId: user.companyId! },
  });

  const data = {
    enabled: input.enabled,
    monthlyAllowance: input.monthlyAllowance,
    minRequestHours: input.minRequestHours,
    maxRequestHours: input.maxRequestHours,
    requestIncrementHours: input.requestIncrementHours,
    carryOverEnabled: input.carryOverEnabled,
    maxCarryOverHours: input.maxCarryOverHours,
    prorateFirstMonth: input.prorateFirstMonth,
    requiresApproval: input.requiresApproval,
  };

  const updated = await prisma.authorisationPolicy.upsert({
    where: { companyId: user.companyId! },
    create: { companyId: user.companyId!, ...data },
    update: data,
  });

  // Enabling populates every ACTIVE user's monthly rows immediately (idempotent).
  if (!before?.enabled && updated.enabled) {
    await syncAuthorisationPeriods(prisma, updated);
  }

  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "authorisation.policy.update",
    entityType: "AuthorisationPolicy",
    entityId: updated.id,
    before,
    after: updated,
    metadata: {
      enabledFrom: before?.enabled ?? false,
      enabledTo: updated.enabled,
      monthlyAllowance: updated.monthlyAllowance,
    },
  });
  return updated;
}

/* ------------------------------ Requests --------------------------------- */

export interface CreateAuthorisationInput {
  date: string;
  startTime: string;
  endTime: string;
  reason?: string;
}

/**
 * Creates a same-day authorisation request (time range) for the current
 * monthly period. The duration is computed ON THE BACKEND from the submitted
 * start/end times (`endTime - startTime`) — a tampered form can never submit a
 * duration that differs from the range it claims. The computed duration is then
 * validated against the policy (min/max/increment) and the available balance
 * before any balance mutation happens.
 */
export async function createAuthorisationRequest(user: SessionUser, input: CreateAuthorisationInput) {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || dbUser.status !== "ACTIVE") {
    throw new AuthorisationError("Your account is not active.", "accountNotActive");
  }

  const policy = await requireAuthorisationPolicy(prisma, user.companyId!);

  if (!isValidISODate(input.date)) {
    throw new AuthorisationError("Pick a valid date.", "authorisationInvalidDate");
  }
  const period = authorisationPeriod(input.date);
  const current = authorisationPeriod(todayISO());
  if (period !== current) {
    throw new AuthorisationError(
      "Authorisations can only be requested for the current monthly period.",
      "authorisationCurrentMonthOnly",
    );
  }

  const startTime = input.startTime?.trim() ?? "";
  const endTime = input.endTime?.trim() ?? "";
  const timeRangeError = validateAuthorisationTimeRange(startTime, endTime);
  if (timeRangeError) throw timeRangeErrorMessage(timeRangeError);

  const hours = authorisationDurationHours(startTime, endTime) ?? 0;
  const hoursError = validateAuthorisationHours(hours, policy);
  if (hoursError) throw hoursErrorMessage(hoursError, policy);

  const balance = await authorisationBalanceFor(prisma, policy, user.id, period);
  if (!balance) {
    throw new AuthorisationError("No authorisation balance is available yet.", "authorisationNoBalance");
  }
  const available = availableAuthorisationHours(balance);
  if (hours > available) {
    throw new AuthorisationError(
      `Insufficient hours: ${available} available, ${hours} requested.`,
      "authorisationInsufficientBalance",
      { available, requested: hours },
    );
  }

  const reason = input.reason?.trim() || null;
  const status: LeaveRequestStatus = policy.requiresApproval ? "PENDING" : "APPROVED";
  const timeRange = `${startTime}–${endTime}`;

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.authorisationRequest.create({
      data: {
        companyId: user.companyId!,
        userId: user.id,
        date: input.date,
        startTime,
        endTime,
        hours,
        reason,
        status,
        approvedById: status === "APPROVED" ? user.id : undefined,
        approvedAt: status === "APPROVED" ? new Date() : undefined,
      },
    });

    await tx.authorisationBalance.update({
      where: { id: balance.id },
      data: status === "APPROVED" ? { used: { increment: hours } } : { pending: { increment: hours } },
    });

    if (status === "PENDING") {
      const approver = await resolveAuthorisationApprover(tx, dbUser);
      if (approver) {
        await tx.notification.create({
          data: {
            userId: approver,
            type: "authorisation.submitted",
            title: `Authorisation request from ${dbUser.name}`,
            body: `${input.date} · ${timeRange} · ${hours} h${reason ? ` — ${reason}` : ""}`,
            entityType: "AuthorisationRequest",
            entityId: created.id,
          },
        });
      }
    }

    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "authorisation.request.create",
      entityType: "AuthorisationRequest",
      entityId: created.id,
      entityName: dbUser.name,
      employeeId: user.id,
      after: { date: input.date, startTime, endTime, hours, status, reason },
    });

    return created;
  });

  return request;
}

/** Active delegation for an approver on a given date, if any. */
async function activeAuthorisationDelegate(
  db: Db,
  approverId: string | null,
  onDate: string,
): Promise<string | null> {
  if (!approverId) return null;
  const rows = await db.approvalDelegation.findMany({
    where: { userId: approverId, active: true },
    orderBy: { createdAt: "desc" },
  });
  const current = rows.find(
    (d: (typeof rows)[number]) => (!d.startsOn || d.startsOn <= onDate) && (!d.endsOn || d.endsOn >= onDate),
  );
  return current?.delegateId ?? null;
}

/**
 * Resolves who approves a PENDING authorisation: the requester's manager
 * (honoring an active delegation), falling back to the company's first
 * HR/ADMIN/SUPER_ADMIN. Null when nobody can approve (HR override can still
 * decide from the approvals queue).
 */
async function resolveAuthorisationApprover(
  db: Db,
  requester: { managerId: string | null; companyId: string },
): Promise<string | null> {
  const delegate = await activeAuthorisationDelegate(db, requester.managerId, todayISO());
  if (requester.managerId) return delegate ?? requester.managerId;
  const hr = await db.user.findFirst({
    where: {
      companyId: requester.companyId,
      status: "ACTIVE",
      role: { in: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    orderBy: { role: "asc" },
    select: { id: true },
  });
  return hr?.id ?? null;
}

/** Owner cancels a PENDING/APPROVED request; reservations/usage are released. */
export async function cancelAuthorisationRequest(user: SessionUser, requestId: string, reason?: string) {
  const request = await prisma.authorisationRequest.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== user.id) {
    throw new AuthorisationError("Request not found.", "requestNotFound");
  }
  if (request.status !== "PENDING" && request.status !== "APPROVED") {
    throw new AuthorisationError("This request can no longer be cancelled.", "cannotCancel");
  }

  await prisma.$transaction(async (tx) => {
    const delta = authorisationTransition(request.status, "CANCELLED");
    await tx.authorisationBalance.updateMany({
      where: { userId: request.userId, period: authorisationPeriod(request.date) },
      data: {
        pending: { increment: delta.pending * request.hours },
        used: { increment: delta.used * request.hours },
      },
    });
    await tx.authorisationRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        cancelledById: user.id,
        cancelReason: reason?.trim() || null,
      },
    });
    await audit(tx, {
      companyId: user.companyId!,
      actorId: user.id,
      action: "authorisation.request.cancel",
      entityType: "AuthorisationRequest",
      entityId: requestId,
      entityName: user.name,
      employeeId: request.userId,
      before: { status: request.status },
      after: { status: "CANCELLED" },
    });
  });

  return { ok: true as const };
}

interface DecisionAuthorisationRequest {
  id: string;
  companyId: string;
  userId: string;
  date: string;
  hours: number;
  status: LeaveRequestStatus;
  user: { name: string; departmentId: string; managerId: string | null };
}

/** Whether `actor` may decide on an authorisation request. */
async function canDecideAuthorisation(
  actor: SessionUser,
  request: DecisionAuthorisationRequest,
): Promise<boolean> {
  const role = actor.role ?? "EMPLOYEE";
  if (role === "HR" || role === "ADMIN" || role === "SUPER_ADMIN") return true;
  if (role !== "MANAGER") return false;
  const departmentId = await resolveDepartmentId(actor);
  if (!departmentId || departmentId !== request.user.departmentId) return false;
  if (request.user.managerId === actor.id) return true;
  const delegate = await activeAuthorisationDelegate(prisma, request.user.managerId, todayISO());
  return delegate === actor.id;
}

export async function decideAuthorisationRequest(
  user: SessionUser,
  requestId: string,
  decision: { outcome: "APPROVED" } | { outcome: "REJECTED"; reason?: string },
) {
  const request = await prisma.authorisationRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { name: true, departmentId: true, managerId: true } } },
  });
  if (!request || request.companyId !== user.companyId) {
    throw new AuthorisationError("Request not found.", "requestNotFound");
  }
  if (!(await canDecideAuthorisation(user, request))) {
    throw new AuthorisationError("You are not the approver for this request.", "notApprover");
  }
  if (request.status !== "PENDING") {
    throw new AuthorisationError("This request has already been processed.", "alreadyProcessed");
  }

  const outcome = decision.outcome;
  const reason = outcome === "REJECTED" ? (decision.reason?.trim() || null) : null;

  await prisma.$transaction(async (tx) => {
    const delta = authorisationTransition("PENDING", outcome);
    await tx.authorisationBalance.updateMany({
      where: { userId: request.userId, period: authorisationPeriod(request.date) },
      data: {
        pending: { increment: delta.pending * request.hours },
        used: { increment: delta.used * request.hours },
      },
    });
    await tx.authorisationRequest.update({
      where: { id: requestId },
      data: {
        status: outcome,
        approvedById: outcome === "APPROVED" ? user.id : undefined,
        approvedAt: outcome === "APPROVED" ? new Date() : undefined,
        rejectionReason: reason,
      },
    });
    await tx.notification.create({
      data: {
        userId: request.userId,
        type: outcome === "APPROVED" ? "request.approved" : "request.rejected",
        title: outcome === "APPROVED" ? "Authorisation approved" : "Authorisation declined",
        body: `${request.date} · ${request.startTime && request.endTime ? `${request.startTime}–${request.endTime} · ` : ""}${request.hours} h${reason ? ` — ${reason}` : ""}`,
        entityType: "AuthorisationRequest",
        entityId: requestId,
      },
    });
    await audit(tx, {
      companyId: request.companyId,
      actorId: user.id,
      action: outcome === "APPROVED" ? "authorisation.request.approve" : "authorisation.request.reject",
      entityType: "AuthorisationRequest",
      entityId: requestId,
      entityName: request.user.name,
      employeeId: request.userId,
      before: { status: "PENDING" },
      after: { status: outcome, hours: request.hours, date: request.date },
    });
  });

  return { ok: true as const };
}

/**
 * PENDING authorisation requests the user can act on: HR/ADMIN/SUPER_ADMIN see
 * the whole company; MANAGER sees only their direct reports' (or delegates')
 * requests within their own department.
 */
export async function listPendingAuthorisations(user: SessionUser) {
  if (!canApprove(user)) return [];
  const isPeopleOps = PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE");
  const departmentId = user.role === "MANAGER" ? await resolveDepartmentId(user) : null;
  const requests = await prisma.authorisationRequest.findMany({
    where: {
      companyId: user.companyId,
      status: "PENDING",
      ...(departmentId ? { user: { departmentId } } : {}),
    },
    include: {
      user: { select: { name: true, departmentId: true, managerId: true, department: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (isPeopleOps) return requests;
  const mine: typeof requests = [];
  for (const request of requests) {
    if (request.user.managerId === user.id) {
      mine.push(request);
      continue;
    }
    const delegate = await activeAuthorisationDelegate(prisma, request.user.managerId, todayISO());
    if (delegate === user.id) mine.push(request);
  }
  return mine;
}

/* --------------------------- Balances & history --------------------------- */

/** The signed-in user's own requests, newest first. */
export async function listAuthorisationRequests(user: SessionUser) {
  return prisma.authorisationRequest.findMany({
    where: { companyId: user.companyId, userId: user.id },
    include: { approvedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Manual balance adjustment for HR/Admin, stored with amount, reason and period. */
export async function adjustAuthorisationForAdmin(
  user: SessionUser,
  input: { userId: string; period?: string; delta: number; reason: string },
) {
  requireHr(user);
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new AuthorisationError("Adjustment must be a non-zero number.", "adjustmentNonZero");
  }
  const policy = await requireAuthorisationPolicy(prisma, user.companyId!);
  const period =
    input.period && isValidAuthorisationPeriod(input.period) ? input.period : authorisationPeriod(todayISO());

  const balance = await authorisationBalanceFor(prisma, policy, input.userId, period);
  if (!balance) {
    throw new AuthorisationError("No authorisation balance row found for this user and period.", "authorisationNoBalance");
  }
  const available = availableAuthorisationHours(balance);
  if (input.delta < 0 && available + input.delta < -0.001) {
    throw new AuthorisationError(
      `Adjustment would take the balance below zero (currently ${available} h).`,
      "authorisationAdjustmentBelowZero",
      { available },
    );
  }
  const reason = input.reason.trim() || "Manual adjustment";

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.authorisationBalance.update({
      where: { id: balance.id },
      data: { adjustment: { increment: input.delta } },
    });
    await tx.authorisationAdjustment.create({
      data: {
        companyId: user.companyId!,
        userId: input.userId,
        period,
        delta: input.delta,
        reason,
      },
    });
    await tx.notification.create({
      data: {
        userId: input.userId,
        type: "balance.adjust",
        title: input.delta > 0 ? "Authorisation hours added" : "Authorisation hours removed",
        body: `${input.delta > 0 ? "+" : ""}${input.delta} h${reason ? ` — ${reason}` : ""}.`,
        entityType: "AuthorisationBalance",
        entityId: balance.id,
      },
    });
    return result;
  });

  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "authorisation.adjust",
    entityType: "AuthorisationBalance",
    entityId: balance.id,
    employeeId: input.userId,
    before: { adjustment: balance.adjustment },
    after: { adjustment: updated.adjustment },
    metadata: { delta: input.delta, reason, period },
  });

  return updated;
}

export interface AuthorisationHistoryPeriod {
  period: string;
  granted: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
  isCurrent: boolean;
  requests: Array<{
    id: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    hours: number;
    status: LeaveRequestStatus;
    reason: string | null;
  }>;
  adjustments: Array<{ id: string; delta: number; reason: string; createdAt: Date }>;
}

/**
 * Whether a monthly period holds actual recorded authorisation activity. A
 * period is shown ONLY when something meaningful happened there: usage, a
 * pending/requested reservation, a manual adjustment, or carried-over hours.
 * An allowance grant alone is not activity — months with nothing recorded are
 * hidden so the history stays clean.
 */
function hasAuthorisationActivity(row: {
  carriedOver: number;
  used: number;
  pending: number;
  requestCount: number;
  adjustmentCount: number;
  adjustment: number;
}): boolean {
  return (
    row.used > 0 ||
    row.pending > 0 ||
    row.carriedOver > 0 ||
    row.adjustment !== 0 ||
    row.requestCount > 0 ||
    row.adjustmentCount > 0
  );
}

/**
 * READ-ONLY per-period history for one employee, exactly as persisted. The
 * viewer may read only their own history unless they hold a people-ops role
 * (HR/ADMIN/SUPER_ADMIN), in which case they may read any employee in their
 * company. Enforcement happens here on the server. Only periods with actual
 * authorisation activity are returned.
 */
export async function authorisationHistoryFor(
  viewer: SessionUser,
  targetUserId: string,
): Promise<AuthorisationHistoryPeriod[]> {
  const isPeopleOps = PEOPLE_OPS_ROLES.has(viewer.role ?? "EMPLOYEE");
  if (!isPeopleOps && viewer.id !== targetUserId) {
    throw new AuthorisationError("You cannot view this employee's authorisations.", "cannotAccessRequest");
  }
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, companyId: viewer.companyId },
    select: { id: true },
  });
  if (!target) throw new AuthorisationError("User not found.", "userNotFound");

  const current = authorisationPeriod(todayISO());
  const [rows, requests, adjustments] = await Promise.all([
    prisma.authorisationBalance.findMany({
      where: { companyId: viewer.companyId, userId: targetUserId },
      orderBy: { period: "desc" },
    }),
    prisma.authorisationRequest.findMany({
      where: { companyId: viewer.companyId, userId: targetUserId },
      orderBy: { date: "asc" },
    }),
    prisma.authorisationAdjustment.findMany({
      where: { companyId: viewer.companyId, userId: targetUserId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const requestsByPeriod = new Map<string, AuthorisationHistoryPeriod["requests"]>();
  for (const r of requests) {
    const bucket = requestsByPeriod.get(authorisationPeriod(r.date)) ?? [];
    bucket.push({
      id: r.id,
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      hours: r.hours,
      status: r.status,
      reason: r.reason,
    });
    requestsByPeriod.set(authorisationPeriod(r.date), bucket);
  }
  const adjustmentsByPeriod = new Map<string, AuthorisationHistoryPeriod["adjustments"]>();
  for (const a of adjustments) {
    const bucket = adjustmentsByPeriod.get(a.period) ?? [];
    bucket.push({ id: a.id, delta: a.delta, reason: a.reason, createdAt: a.createdAt });
    adjustmentsByPeriod.set(a.period, bucket);
  }

  return rows
    .map((row) => {
      const periodRequests = requestsByPeriod.get(row.period) ?? [];
      const periodAdjustments = adjustmentsByPeriod.get(row.period) ?? [];
      return {
        period: row.period,
        granted: row.granted,
        carriedOver: row.carriedOver,
        adjustment: row.adjustment,
        used: row.used,
        pending: row.pending,
        available: availableAuthorisationHours(row),
        isCurrent: row.period === current,
        requests: periodRequests,
        adjustments: periodAdjustments,
      };
    })
    .filter((period) =>
      hasAuthorisationActivity({
        carriedOver: period.carriedOver,
        used: period.used,
        pending: period.pending,
        adjustment: period.adjustment,
        requestCount: period.requests.length,
        adjustmentCount: period.adjustments.length,
      }),
    );
}

/** Everything the dashboard needs in one call; null when the module is off. */
export async function authorisationOverviewFor(user: SessionUser) {
  const policy = await getAuthorisationPolicy(prisma, user.companyId!);
  if (!policy?.enabled) return null;
  const period = authorisationPeriod(todayISO());
  const balance = await authorisationBalanceFor(prisma, policy, user.id, period);
  const [upcoming, recent] = await Promise.all([
    prisma.authorisationRequest.findMany({
      where: { userId: user.id, status: { in: ["APPROVED", "PENDING"] } },
      orderBy: { date: "asc" },
      take: 4,
    }),
    listAuthorisationRequests(user),
  ]);
  return {
    policy,
    period,
    balance,
    available: balance ? availableAuthorisationHours(balance) : 0,
    used: balance ? balance.used : 0,
    pending: balance ? balance.pending : 0,
    upcoming,
    recent,
  };
}
