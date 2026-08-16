import { prisma, Prisma, type DayPart, type LeaveRequestStatus } from "@timeoff/db";
import {
  accruedVacationAsOf,
  addDaysISO,
  availableBalance,
  cappedCarryOver,
  computeLeaveDays,
  isValidISODate,
  LeaveSpanError,
  leaveYearRange,
  spansOverlap,
  todayISO,
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
    policies.find((p: (typeof policies)[number]) => p.departmentId === departmentId) ??
    policies.find((p: (typeof policies)[number]) => p.departmentId === null) ??
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

type CurrentBalanceRow = NonNullable<Awaited<ReturnType<typeof currentBalance>>>;

/** LeavePolicy subset with the fields the accrual engine needs. */
type AccrualPolicy = {
  id: string;
  leaveTypeId: string;
  departmentId: string | null;
  countryCode: string | null;
  annualAllotment: number;
  carryOverDays: number;
};

/**
 * The effective accrual policy for a user/leave type (same matching as
 * `getPolicy`): a department-specific row wins over the company-wide one,
 * and the country-code scope must match (null = all countries).
 */
function effectivePolicyFor(
  policies: AccrualPolicy[],
  departmentId: string,
  countryCode: string,
  leaveTypeId: string,
): AccrualPolicy | null {
  const matches = policies.filter(
    (p) =>
      p.leaveTypeId === leaveTypeId &&
      (p.departmentId === null || p.departmentId === departmentId) &&
      (p.countryCode === null || p.countryCode === countryCode),
  );
  return (
    matches.find((p) => p.departmentId === departmentId) ??
    matches.find((p) => p.departmentId === null) ??
    null
  );
}

/** The leave year a date falls in: `{ startYear, start, end }` (day 1 of the fiscal month). */
function currentLeaveYear(fiscal: number, onDate: string): { startYear: number; start: string; end: string } {
  const year = Number(onDate.slice(0, 4));
  const month = Number(onDate.slice(5, 7));
  const startYear = fiscal > 1 && month < fiscal ? year - 1 : year;
  const { start, end } = leaveYearRange(fiscal, startYear);
  return { startYear, start, end };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Days a user consumed against a specific leave year (APPROVED + PENDING),
 *  matching how the app attributes usage: by the request's start date. */
async function vacationUsedInRange(
  db: Db,
  userId: string,
  leaveTypeId: string,
  range: { start: string; end: string },
): Promise<number> {
  const rows = await db.leaveRequest.findMany({
    where: {
      userId,
      leaveTypeId,
      status: { in: ["APPROVED", "PENDING"] },
      startDate: { gte: range.start, lte: range.end },
    },
    select: { totalDays: true },
  });
  return round2(rows.reduce((sum, r) => sum + r.totalDays, 0));
}

/**
 * The accrual attributable to a single leave-year period, i.e. the cumulative
 * engine's value as of `asOf` minus its value as of the day before the period
 * started. Rows therefore hold only their own year's slice (e.g. 12 days for
 * 2026 through August), while the cumulative engine still drives the numbers
 * under the hood. Floored at 0 so a row reconciled before its period ever
 * begins never goes negative.
 */
function perYearAccrued(options: {
  annualAllotment: number;
  employmentStartDate: string;
  fullTimeRatio: number;
  periodStart: string;
  periodEnd: string;
  asOf: string;
}): number {
  const asOf = options.asOf < options.periodEnd ? options.asOf : options.periodEnd;
  const cumulative = accruedVacationAsOf({
    annualAllotment: options.annualAllotment,
    employmentStartDate: options.employmentStartDate,
    asOf,
    fullTimeRatio: options.fullTimeRatio,
  });
  const prior = accruedVacationAsOf({
    annualAllotment: options.annualAllotment,
    employmentStartDate: options.employmentStartDate,
    asOf: addDaysISO(options.periodStart, -1),
    fullTimeRatio: options.fullTimeRatio,
  });
  return Math.max(0, round2(cumulative - prior));
}

/**
 * Preloaded inputs for carry-over computation, fetched once per company so the
 * mass reconciliation in `syncCurrentAccruals` avoids N+1 queries. Carries the
 * exact same data `carryOverFor` would query per row, so results are identical
 * — only the transport changes. Absent for single-user write paths
 * (`resolveBalanceForDate`), which keep querying per row.
 */
interface CarryOverContext {
  /** `userId:leaveTypeId` → sum of adjustment on rows ending before the target year. */
  historicalAdjustments: Map<string, number>;
  /** All APPROVED/PENDING requests company-wide; filtered in memory per user. */
  usage: Array<{ userId: string; leaveTypeId: string; startDate: string; totalDays: number }>;
}

/**
 * How many days carry into the leave year starting at `targetYearStart`, capped
 * at the policy limit (L4).
 *
 * The cap applies to the employee's TOTAL eligible unused historical vacation,
 * not just the immediately preceding year: everything earned through the end of
 * the last complete year before the target year (the cumulative engine never
 * resets), plus all historical balance adjustments, minus everything committed
 * to vacation. For example, 10 unused from 2024 plus 12 unused from 2025 carry
 * min(22, limit) into 2026; an employee hired in 2010 who has never taken leave
 * carries min(lifetime, limit), never the whole lifetime total.
 *
 * Earned = `accruedVacationAsOf` as of the prior year's end. Usage = the
 * employee's committed APPROVED/PENDING vacation across the whole history (the
 * app's single source of truth for what was taken, regardless of whether a
 * balance row exists for every single year). Historical rows contribute their
 * `adjustment` grants/takes; their stored `carriedOver` is deliberately
 * excluded — it is the surplus of even earlier years, so adding it would
 * double-count.
 *
 * `cappedCarryOver` clamps the result to `[0, carryOverDays]`. Never returns
 * null: a year with no prior history simply carries 0 (a new employee or a
 * brand-new company has nothing to roll over), and carry explicitly disabled
 * (`carryOverDays <= 0`) is 0.
 */
async function carryOverFor(
  db: Db,
  company: { id: string; fiscalYearStartMonth: number },
  user: { id: string; employmentStartDate: string; employmentType: string },
  leaveTypeId: string,
  policy: { annualAllotment: number; carryOverDays: number },
  targetYearStart: string,
  ctx?: CarryOverContext,
): Promise<number> {
  if (policy.carryOverDays <= 0) return 0;
  const targetStartYear = Number(targetYearStart.slice(0, 4));
  const priorRange = leaveYearRange(company.fiscalYearStartMonth, targetStartYear - 1);
  const ratio = user.employmentType === "PART_TIME" ? 0.5 : 1;

  // Everything the employee could ever have drawn on through the end of the
  // last complete leave year before the target year.
  const earnedThroughPriorYear = accruedVacationAsOf({
    annualAllotment: policy.annualAllotment,
    employmentStartDate: user.employmentStartDate,
    asOf: priorRange.end,
    fullTimeRatio: ratio,
  });

  // Historical yearly records strictly before the target year. Their
  // `adjustment` grants/takes days; `carriedOver` is deliberately excluded (the
  // surplus of even earlier years — adding it would double-count).
  const totalAdjustments = ctx
    ? round2(ctx.historicalAdjustments.get(`${user.id}:${leaveTypeId}`) ?? 0)
    : round2(
        (await db.leaveBalance.findMany({
          where: { userId: user.id, leaveTypeId, periodEnd: { lte: priorRange.end } },
          orderBy: { periodStart: "asc" },
        })).reduce((sum, r) => sum + r.adjustment, 0),
      );

  // Usage is the employee's committed APPROVED/PENDING vacation across the
  // whole history — the app's single source of truth for what was taken.
  const totalUsed = ctx
    ? round2(
        ctx.usage.reduce((sum, r) => {
          if (r.userId !== user.id || r.leaveTypeId !== leaveTypeId) return sum;
          if (r.startDate < user.employmentStartDate || r.startDate > priorRange.end) return sum;
          return sum + r.totalDays;
        }, 0),
      )
    : await vacationUsedInRange(db, user.id, leaveTypeId, {
        start: user.employmentStartDate,
        end: priorRange.end,
      });

  const totalUnused = Math.max(0, round2(earnedThroughPriorYear + totalAdjustments - totalUsed));
  return round2(cappedCarryOver(policy.carryOverDays, totalUnused));
}

/**
 * Brings one balance row in line with the per-year accrual model:
 *  - `accrued` is recomputed as the current row's own year slice (`perYearAccrued`)
 *    as of `min(today, periodEnd)` so a past year is frozen at its year-end value
 *    while the current year keeps growing;
 *  - `carriedOver` is recomputed for the current (and any future) year's row
 *    from the employee's total eligible unused history capped at the policy
 *    limit — so the displayed component always reflects real historical data and
 *    reacts to policy-limit changes. Historical rows (periodStart before the
 *    current year) keep their stored value.
 * Manual adjustment, used and pending are never touched. Idempotent: returns
 * the row unchanged when nothing differs.
 */
async function reconcileBalanceRow(
  db: Db,
  company: { id: string; fiscalYearStartMonth: number },
  user: { employmentStartDate: string; employmentType: string },
  policy: { annualAllotment: number; carryOverDays: number },
  row: CurrentBalanceRow,
  ctx?: CarryOverContext,
) {
  const today = todayISO();
  const ratio = user.employmentType === "PART_TIME" ? 0.5 : 1;
  const asOf = row.periodEnd < today ? row.periodEnd : today;
  const freshAccrued = perYearAccrued({
    annualAllotment: policy.annualAllotment,
    employmentStartDate: user.employmentStartDate,
    fullTimeRatio: ratio,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    asOf,
  });
  const current = currentLeaveYear(company.fiscalYearStartMonth, today);
  let freshCarriedOver = row.carriedOver;
  if (row.periodStart >= current.start) {
    freshCarriedOver = await carryOverFor(
      db,
      company,
      { ...user, id: row.userId },
      row.leaveTypeId,
      policy,
      row.periodStart,
      ctx,
    );
  }
  const data: { accrued?: number; carriedOver?: number } = {};
  if (freshAccrued !== row.accrued) data.accrued = freshAccrued;
  if (freshCarriedOver !== row.carriedOver) data.carriedOver = freshCarriedOver;
  if (data.accrued === undefined && data.carriedOver === undefined) return row;
  return db.leaveBalance.update({ where: { id: row.id }, data });
}

/**
 * Reconciles every ACTIVE user's current and immediately-preceding leave-year
 * balance rows to the per-year accrual as of today (the "current calculation
 * date"), so the displayed balance keeps growing month over month within the
 * current year and the carried-over component reflects the total eligible
 * unused history. Only `accrued` and `carriedOver` are touched — adjustment,
 * used and pending are preserved. Idempotent: rows already correct are left
 * alone.
 *
 * Pass `userId` to reconcile a single user instead of the whole company — used
 * by personal pages (dashboard, request form) whose displayed balances belong
 * to exactly one employee. The per-row math is identical; only the input scope
 * narrows, so the reconciled values are the same either way.
 */
export async function syncCurrentAccruals(db: Db, companyId: string, userId?: string): Promise<void> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, fiscalYearStartMonth: true },
  });
  const today = todayISO();
  const current = currentLeaveYear(company.fiscalYearStartMonth, today);
  const priorStart = leaveYearRange(company.fiscalYearStartMonth, current.startYear - 1).start;
  const rows = await db.leaveBalance.findMany({
    where: {
      companyId,
      periodStart: { lte: today },
      periodEnd: { gte: priorStart },
      user: { status: "ACTIVE" },
      ...(userId ? { userId } : {}),
    },
    include: {
      user: {
        select: { employmentStartDate: true, employmentType: true, departmentId: true, countryCode: true },
      },
    },
  });
  if (rows.length === 0) return;

  const policies = await db.leavePolicy.findMany({
    where: { companyId, annualAllotment: { gt: 0 } },
    select: {
      id: true,
      leaveTypeId: true,
      departmentId: true,
      countryCode: true,
      annualAllotment: true,
      carryOverDays: true,
    },
  });

  // Load the carry-over inputs once instead of per row: historical rows
  // (adjustments) and committed APPROVED/PENDING usage, both bounded by the end
  // of the leave year before the current one. Each current-year row recomputes
  // its carry-over against these same inputs, so the math is identical to the
  // per-row query path — just without N+1. Scoped to `userId` when given.
  const priorRangeEnd = leaveYearRange(company.fiscalYearStartMonth, current.startYear - 1).end;
  const [historicalBalances, usage] = await Promise.all([
    db.leaveBalance.findMany({
      where: { companyId, periodEnd: { lte: priorRangeEnd }, ...(userId ? { userId } : {}) },
      select: { userId: true, leaveTypeId: true, adjustment: true },
    }),
    db.leaveRequest.findMany({
      where: { companyId, status: { in: ["APPROVED", "PENDING"] }, ...(userId ? { userId } : {}) },
      select: { userId: true, leaveTypeId: true, startDate: true, totalDays: true },
    }),
  ]);
  const historicalAdjustments = new Map<string, number>();
  for (const b of historicalBalances) {
    const key = `${b.userId}:${b.leaveTypeId}`;
    historicalAdjustments.set(key, (historicalAdjustments.get(key) ?? 0) + b.adjustment);
  }
  const carryOverContext: CarryOverContext = { historicalAdjustments, usage };
  for (const row of rows) {
    const policy = effectivePolicyFor(
      policies,
      row.user.departmentId,
      row.user.countryCode,
      row.leaveTypeId,
    );
    if (!policy) continue;
    const updated = await reconcileBalanceRow(
      db,
      company,
      { employmentStartDate: row.user.employmentStartDate, employmentType: row.user.employmentType },
      policy,
      row,
      carryOverContext,
    );
    if (updated.accrued !== row.accrued || updated.carriedOver !== row.carriedOver) {
      await audit(db, {
        companyId,
        actorId: null,
        action: "balance.sync",
        entityType: "LeaveBalance",
        entityId: updated.id,
        before: { accrued: row.accrued, carriedOver: row.carriedOver },
        after: { accrued: updated.accrued, carriedOver: updated.carriedOver },
        metadata: { source: "accrual-sync" },
      });
    }
  }
}

type BalanceResolution =
  | {
      existing: true;
      row: CurrentBalanceRow;
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
 * Carry-over: when planning a *new* leave year, up to `carryOverDays` of the
 * employee's total eligible unused history is rolled into the plan (L4). Days
 * are carried at most once — never cascading. Existing rows covering today are
 * reconciled (accrued + carriedOver) by the same engine the display paths use,
 * so what the employee sees equals what is enforced.
 */
export async function resolveBalanceForDate(
  db: Db,
  company: { id: string; fiscalYearStartMonth: number },
  user: { id: string; companyId: string; employmentStartDate: string; employmentType: string },
  leaveTypeId: string,
  policy: { annualAllotment: number; carryOverDays: number } | null,
  onDate: string,
): Promise<BalanceResolution | null> {
  const today = todayISO();
  const ratio = user.employmentType === "PART_TIME" ? 0.5 : 1;
  const existing = await currentBalance(db, user.id, leaveTypeId, onDate);
  if (existing) {
    // Per-year accrual grows with the calendar and carry-over follows the total
    // eligible unused history: whenever an existing row covers the current
    // calculation date (today), reconcile it so the balance keeps accruing
    // month over month and the carried-over component stays right — the same
    // single engine the display paths use. Manual adjustment, used and
    // pending are never touched.
    if (policy && existing.periodStart <= today && existing.periodEnd >= today) {
      const updated = await reconcileBalanceRow(db, company, user, policy, existing);
      return { existing: true, row: updated, available: availableBalance(updated) };
    }
    return { existing: true, row: existing, available: availableBalance(existing) };
  }
  if (!policy || policy.annualAllotment <= 0) return null;

  const { start, end } = currentLeaveYear(company.fiscalYearStartMonth, onDate);
  const accrued = perYearAccrued({
    annualAllotment: policy.annualAllotment,
    employmentStartDate: user.employmentStartDate,
    fullTimeRatio: ratio,
    periodStart: start,
    periodEnd: end,
    asOf: today,
  });

  let carriedOver = 0;
  if (policy.carryOverDays > 0) {
    carriedOver = await carryOverFor(db, company, user, leaveTypeId, policy, start);
  }

  return {
    existing: false,
    plan: { periodStart: start, periodEnd: end, accrued, carriedOver },
    available: accrued + carriedOver,
  };
}

/**
 * Materializes the current leave-year balance rows for a newly created user,
 * using the exact same proration math as `resolveBalanceForDate` so a fresh
 * account starts with a correct balance instead of an empty one (L8).
 *
 * Seeds every leave type whose effective policy grants a positive annual
 * allotment; rows the user already has for the current year are left alone.
 * Carried-over days are always 0 here (a brand-new user has no prior year),
 * and `accrued` holds only the current year's slice (`perYearAccrued`).
 * Non-retroactive by construction: only the new user's rows are created.
 *
 * Returns the number of balance rows created.
 */
export async function seedBalancesForNewUser(
  db: Db,
  company: { id: string; fiscalYearStartMonth: number },
  user: {
    id: string;
    companyId: string;
    departmentId: string;
    countryCode: string;
    employmentStartDate: string;
    employmentType: string;
  },
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const fiscal = company.fiscalYearStartMonth;
  const startYear = fiscal > 1 && month < fiscal ? year - 1 : year;
  const { start, end } = leaveYearRange(fiscal, startYear);

  const policies = await db.leavePolicy.findMany({
    where: { companyId: company.id, annualAllotment: { gt: 0 } },
    select: {
      id: true,
      leaveTypeId: true,
      departmentId: true,
      countryCode: true,
      annualAllotment: true,
      carryOverDays: true,
    },
  });
  // Department-specific policy wins over the company-wide one (getPolicy).
  const effective = new Map<string, (typeof policies)[number]>();
  for (const leaveTypeId of new Set(policies.map((p) => p.leaveTypeId))) {
    const policy = effectivePolicyFor(policies, user.departmentId, user.countryCode, leaveTypeId);
    if (policy) effective.set(leaveTypeId, policy);
  }

  const existing = await db.leaveBalance.findMany({
    where: { userId: user.id, periodStart: start, periodEnd: end },
    select: { leaveTypeId: true },
  });
  const existingTypes = new Set(existing.map((b) => b.leaveTypeId));

  const ratio = user.employmentType === "PART_TIME" ? 0.5 : 1;
  let created = 0;
  for (const [leaveTypeId, policy] of effective) {
    if (existingTypes.has(leaveTypeId)) continue;
    await db.leaveBalance.create({
      data: {
        companyId: company.id,
        userId: user.id,
        leaveTypeId,
        periodStart: start,
        periodEnd: end,
        accrued: perYearAccrued({
          annualAllotment: policy.annualAllotment,
          employmentStartDate: user.employmentStartDate,
          fullTimeRatio: ratio,
          periodStart: start,
          periodEnd: end,
          asOf: today,
        }),
        carriedOver: 0,
        adjustment: 0,
        used: 0,
        pending: 0,
      },
    });
    created += 1;
  }
  return created;
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
    (d: (typeof rows)[number]) => (!d.startsOn || d.startsOn <= onDate) && (!d.endsOn || d.endsOn >= onDate),
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

/** Keys whose values must never be stored in the audit trail. */
const SENSITIVE_KEY_RE = /passw|secret|token|apikey|api[_-]?key|credential|session|auth|cookie/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) continue;
      out[key] = sanitizeValue(val);
    }
    return out;
  }
  return value;
}

/** Strips secrets from before/after/metadata before they hit the audit table. */
function sanitizeJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return sanitizeValue(value) as Prisma.InputJsonValue;
}

/** Resolves the actor display name; null when the actor is a system process. */
async function resolveActorName(db: Db, actorId: string | null): Promise<string | null> {
  if (!actorId) return null;
  const row = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
  return row?.name ?? null;
}

/** Resolves the affected employee id (+ display name for named entities). */
async function resolveAuditTarget(
  db: Db,
  entityType: string,
  entityId: string | null,
): Promise<{ entityName: string | null; employeeId: string | null }> {
  if (!entityId) return { entityName: null, employeeId: null };
  switch (entityType) {
    case "User":
    case "user":
      return db.user
        .findUnique({ where: { id: entityId }, select: { name: true } })
        .then((row) => ({ entityName: row?.name ?? null, employeeId: entityId }));
    case "LeaveRequest":
    case "leaveRequest":
      return db.leaveRequest
        .findUnique({
          where: { id: entityId },
          select: { userId: true, user: { select: { name: true } } },
        })
        .then((row) => ({ entityName: row?.user?.name ?? null, employeeId: row?.userId ?? null }));
    case "LeaveBalance":
    case "leaveBalance":
      return db.leaveBalance
        .findUnique({
          where: { id: entityId },
          select: { userId: true, user: { select: { name: true } } },
        })
        .then((row) => ({ entityName: row?.user?.name ?? null, employeeId: row?.userId ?? null }));
    case "Department":
    case "department":
      return db.department
        .findUnique({ where: { id: entityId }, select: { name: true } })
        .then((row) => ({ entityName: row?.name ?? null, employeeId: null }));
    case "LeaveType":
    case "leaveType":
      return db.leaveType
        .findUnique({ where: { id: entityId }, select: { name: true } })
        .then((row) => ({ entityName: row?.name ?? null, employeeId: null }));
    case "LeavePolicy":
    case "leavePolicy":
      return db.leavePolicy
        .findUnique({ where: { id: entityId }, select: { name: true } })
        .then((row) => ({ entityName: row?.name ?? null, employeeId: null }));
    case "AuthorisationRequest":
    case "authorisationRequest":
      return db.authorisationRequest
        .findUnique({
          where: { id: entityId },
          select: { userId: true, user: { select: { name: true } } },
        })
        .then((row) => ({ entityName: row?.user?.name ?? null, employeeId: row?.userId ?? null }));
    case "AuthorisationBalance":
    case "authorisationBalance":
      return db.authorisationBalance
        .findUnique({
          where: { id: entityId },
          select: { userId: true, user: { select: { name: true } } },
        })
        .then((row) => ({ entityName: row?.user?.name ?? null, employeeId: row?.userId ?? null }));
    case "AuthorisationPolicy":
    case "authorisationPolicy":
      return db.authorisationPolicy
        .findUnique({ where: { id: entityId }, select: { company: { select: { name: true } } } })
        .then((row) => ({ entityName: row?.company?.name ?? null, employeeId: null }));
    case "Company":
    case "company":
      return db.company
        .findUnique({ where: { id: entityId }, select: { name: true } })
        .then((row) => ({ entityName: row?.name ?? null, employeeId: null }));
    default:
      return { entityName: null, employeeId: null };
  }
}

/**
 * Appends an immutable audit entry. `actorId` is optional: null/omitted means
 * a system process (e.g. scheduled accrual sync). Display names and the
 * affected employee are resolved automatically (and survive later deletion),
 * or can be supplied explicitly to avoid an extra query.
 */
export async function audit(
  db: Db,
  input: {
    companyId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
    actorName?: string | null;
    entityName?: string | null;
    employeeId?: string | null;
  },
): Promise<void> {
  const [actorName, target] = await Promise.all([
    input.actorName !== undefined ? Promise.resolve(input.actorName) : resolveActorName(db, input.actorId ?? null),
    input.entityName !== undefined && input.employeeId !== undefined
      ? Promise.resolve(null)
      : resolveAuditTarget(db, input.entityType, input.entityId),
  ]);
  const entityName = input.entityName !== undefined ? input.entityName : (target?.entityName ?? null);
  const employeeId = input.employeeId !== undefined ? input.employeeId : (target?.employeeId ?? null);
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      actorId: input.actorId ?? null,
      actorNameSnapshot: actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityNameSnapshot: entityName,
      employeeId,
      before: sanitizeJson(input.before),
      after: sanitizeJson(input.after),
      metadata: sanitizeJson(input.metadata),
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

  // Day parts are tamperable via FormData — validate before anything else.
  const validParts = ["FULL", "FIRST_HALF", "SECOND_HALF"];
  if (!validParts.includes(startDayPart) || !validParts.includes(endDayPart)) {
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

  // Half-day policy is enforced server-side (source of truth), so a tampered
  // form can never bypass the company's half-day settings.
  if (!company.halfDayEnabled && (startDayPart !== "FULL" || endDayPart !== "FULL")) {
    throw new LeaveError("Half-day leave is not enabled for your company.");
  }
  if (startDayPart !== "FULL" && !company.halfDayStartDay) {
    throw new LeaveError("Half-day starts are not allowed by company policy.");
  }
  if (endDayPart !== "FULL" && !company.halfDayEndDay) {
    throw new LeaveError("Half-day ends are not allowed by company policy.");
  }

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
      {
        holidays,
        countWeekendsWithinSpan: company.countWeekendsWithinSpan,
        extendWeekendAfterFriday: company.extendWeekendAfterFriday,
        countHolidaysAsVacationDays: company.countHolidaysAsVacationDays,
      },
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
      {
        holidays,
        countWeekendsWithinSpan: company.countWeekendsWithinSpan,
        countHolidaysAsVacationDays: company.countHolidaysAsVacationDays,
      },
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
        days: { create: days.map((day: (typeof days)[number]) => ({ date: day.date, dayPart: day.dayPart })) },
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
      entityName: dbUser.name,
      employeeId: user.id,
      after: { status, totalDays, startDate, endDate, leaveType: leaveType.name },
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
      employeeId: request.userId,
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
      entityName: request.user.name,
      employeeId: request.userId,
      before: { status: "PENDING", level: request.currentApprovalLevel },
      after: { status: nextStatus, level: nextLevel, leaveType: request.leaveType.name },
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
    entityName: delegate.name,
    employeeId: user.id,
    after: { delegateName: delegate.name, startsOn: created.startsOn, endsOn: created.endsOn },
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
    employeeId: delegation.userId,
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

/* --------------------------- Balance history ----------------------------- */

export interface BalanceHistoryActivity {
  startDate: string;
  endDate: string;
  leaveType: string;
  totalDays: number;
  status: LeaveRequestStatus;
  reason: string | null;
}

export interface BalanceHistoryYear {
  periodStart: string;
  periodEnd: string;
  leaveType: string;
  accrued: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
  isCurrent: boolean;
  activity: BalanceHistoryActivity[];
}

/**
 * READ-ONLY balance history for one employee: the stored yearly balance rows
 * exactly as persisted (newest leave year first), each with its committed
 * APPROVED/PENDING leave activity for that year. `available` is the stored
 * formula from the domain package (`availableBalance`), never recalculated
 * against today's policy — a later policy change must not rewrite the past.
 *
 * This function never calls `syncCurrentAccruals` and never writes anything.
 * The viewer may read only their own history unless they hold a people-ops
 * role (HR/ADMIN/SUPER_ADMIN), in which case they may read any employee (active
 * or not) within their own company. Enforcement happens here on the server.
 *
 * Two fixed queries (balances + requests), no N+1.
 */
export async function balanceHistoryFor(
  viewer: SessionUser,
  targetUserId: string,
): Promise<BalanceHistoryYear[]> {
  const isPeopleOps = PEOPLE_OPS_ROLES.has(viewer.role ?? "EMPLOYEE");
  if (!isPeopleOps && viewer.id !== targetUserId) {
    throw new LeaveError("You cannot view this employee's balance history.", "cannotAccessRequest");
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: viewer.companyId },
    select: { fiscalYearStartMonth: true },
  });
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, companyId: viewer.companyId },
    select: { id: true },
  });
  if (!target) throw new LeaveError("User not found.", "userNotFound");

  const today = todayISO();
  const [rows, requests] = await Promise.all([
    prisma.leaveBalance.findMany({
      where: { companyId: viewer.companyId, userId: targetUserId },
      include: { leaveType: { select: { name: true } } },
      orderBy: { periodStart: "desc" },
    }),
    prisma.leaveRequest.findMany({
      where: {
        companyId: viewer.companyId,
        userId: targetUserId,
        status: { in: ["APPROVED", "PENDING"] },
      },
      include: { leaveType: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  // Bucket requests into leave years by their start date — the app's existing
  // attribution rule — keyed on the leave year's period start.
  const byYear = new Map<string, { activity: BalanceHistoryActivity[] }>();
  for (const r of requests) {
    const { start } = currentLeaveYear(company.fiscalYearStartMonth, r.startDate);
    const bucket = byYear.get(start) ?? { activity: [] };
    bucket.activity.push({
      startDate: r.startDate,
      endDate: r.endDate,
      leaveType: r.leaveType.name,
      totalDays: r.totalDays,
      status: r.status,
      reason: r.reason,
    });
    byYear.set(start, bucket);
  }

  return rows.map((row) => {
    const bucket = byYear.get(row.periodStart);
    return {
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      leaveType: row.leaveType.name,
      accrued: row.accrued,
      carriedOver: row.carriedOver,
      adjustment: row.adjustment,
      used: row.used,
      pending: row.pending,
      available: availableBalance(row),
      isCurrent: row.periodStart <= today && row.periodEnd >= today,
      activity: bucket?.activity ?? [],
    };
  });
}
