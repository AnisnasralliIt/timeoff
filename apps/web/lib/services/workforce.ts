import { prisma } from "@timeoff/db";
import { addDaysISO, leaveYearRange, todayISO } from "@timeoff/domain";
import type { SessionUser } from "@/lib/session";
import { getVisibleUserIds, getUserScope, resolveDepartmentId } from "@/lib/permissions";
import { listPendingForApproval, syncCurrentAccruals } from "@/lib/services/leave";

/**
 * A vacation balance below this many days counts as "low" on the workforce
 * dashboard. This is a business rule for flagging, not fabricated data — every
 * number displayed still comes from the database.
 */
const LOW_BALANCE_THRESHOLD_DAYS = 5;

export interface WorkforceFilters {
  /** `periodStart` (YYYY-MM-DD) of the leave year to report against. */
  leaveYearStart?: string;
  /** Only applied for company-wide roles; managers are always locked to their own department. */
  departmentId?: string;
}

/** The leave year a date falls in: `{ startYear, start, end }` (day 1 of the fiscal month). */
function currentLeaveYear(fiscal: number, onDate: string): { startYear: number; start: string; end: string } {
  const year = Number(onDate.slice(0, 4));
  const month = Number(onDate.slice(5, 7));
  const startYear = fiscal > 1 && month < fiscal ? year - 1 : year;
  const { start, end } = leaveYearRange(fiscal, startYear);
  return { startYear, start, end };
}

/** Every `YYYY-MM` key spanning a leave-year range (inclusive of its end month). */
function monthsInRange(start: string, end: string): string[] {
  const keys: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/**
 * Everything the workforce dashboard renders, computed from real DB data and
 * scoped exactly like every other visibility-bearing query: company-wide roles
 * see the whole company, managers only their own department. Idempotent — it
 * runs the same `syncCurrentAccruals` reconcile the admin overview uses before
 * reporting balances.
 */
export async function workforceStats(user: SessionUser, filters: WorkforceFilters = {}) {
  const companyId = user.companyId!;
  const today = todayISO();
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { fiscalYearStartMonth: true },
  });
  const scope = getUserScope(user);
  const showDepartmentFilter = scope.kind === "all";
  const visible = await getVisibleUserIds(user);
  // Authoritative department id for manager scoping (session may be stale).
  const managerDepartmentId =
    scope.kind === "department" ? ((await resolveDepartmentId(user)) ?? scope.departmentId) : null;

  // Department filter is only honoured for company-wide roles; managers are
  // always locked to their own department (same rule as the calendar).
  const departmentFilter =
    showDepartmentFilter && filters.departmentId ? filters.departmentId : undefined;

  // Leave year: default to the current one, otherwise the one selected.
  const currentYear = currentLeaveYear(company.fiscalYearStartMonth, today);
  const selectedYearStart = filters.leaveYearStart
    ? leaveYearRange(company.fiscalYearStartMonth, Number(filters.leaveYearStart.slice(0, 4))).start
    : currentYear.start;
  const selectedYearEnd = leaveYearRange(
    company.fiscalYearStartMonth,
    Number(selectedYearStart.slice(0, 4)),
  ).end;

  const userWhere = visible === "all" ? {} : { id: { in: visible } };
  const visibleWhere = visible === "all" ? {} : { userId: { in: visible } };

  await syncCurrentAccruals(prisma, companyId);

  const [activeCount, offTodayRequests, pendingCount, yearRequests, balances, allDepartments, upcoming] =
    await Promise.all([
      prisma.user.count({
        where: {
          companyId,
          status: "ACTIVE",
          ...userWhere,
          ...(departmentFilter ? { departmentId: departmentFilter } : {}),
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          companyId,
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
          ...visibleWhere,
          ...(departmentFilter ? { user: { departmentId: departmentFilter } } : {}),
        },
        include: {
          user: { include: { department: true } },
          leaveType: { select: { name: true, color: true } },
        },
      }),
      prisma.leaveRequest.count({
        where: {
          companyId,
          status: "PENDING",
          ...(visible === "all" ? {} : { userId: { in: visible } }),
          ...(departmentFilter ? { user: { departmentId: departmentFilter } } : {}),
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          companyId,
          status: "APPROVED",
          startDate: { gte: selectedYearStart, lte: selectedYearEnd },
          ...visibleWhere,
          ...(departmentFilter ? { user: { departmentId: departmentFilter } } : {}),
        },
        include: {
          user: { include: { department: true } },
          leaveType: { select: { name: true, color: true } },
        },
      }),
      prisma.leaveBalance.findMany({
        where: {
          companyId,
          periodStart: { lte: today },
          periodEnd: { gte: today },
          user: {
            status: "ACTIVE",
            ...userWhere,
            ...(departmentFilter ? { departmentId: departmentFilter } : {}),
          },
        },
        include: {
          user: { select: { id: true, name: true, departmentId: true } },
          leaveType: { select: { name: true } },
        },
      }),
      prisma.department.findMany({
        where: { companyId },
        include: { _count: { select: { users: { where: { status: "ACTIVE" } } } } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.leaveRequest.findMany({
        where: {
          companyId,
          status: "APPROVED",
          startDate: { gte: today, lte: selectedYearEnd },
          ...visibleWhere,
          ...(departmentFilter ? { user: { departmentId: departmentFilter } } : {}),
        },
        include: {
          user: { include: { department: true } },
          leaveType: { select: { name: true, color: true } },
        },
        orderBy: { startDate: "asc" },
        take: 8,
      }),
    ]);

  const offToday = new Set(offTodayRequests.map((r: (typeof offTodayRequests)[number]) => r.userId)).size;
  const approvedDays = yearRequests.reduce(
    (sum: number, r: (typeof yearRequests)[number]) => sum + r.totalDays,
    0,
  );

  // Current vacation balances (reconciled above). One row per user per type.
  const vacationRows = balances.filter((b: (typeof balances)[number]) => b.leaveType.name === "Vacation");
  const availableToday = vacationRows.reduce(
    (sum: number, b: (typeof vacationRows)[number]) =>
      sum + (b.accrued + b.carriedOver + b.adjustment - b.used - b.pending),
    0,
  );
  const lowBalances = vacationRows
    .map((b: (typeof vacationRows)[number]) => ({
      userId: b.user.id,
      userName: b.user.name,
      departmentName:
        allDepartments.find((d: (typeof allDepartments)[number]) => d.id === b.user.departmentId)?.name ?? null,
      available: b.accrued + b.carriedOver + b.adjustment - b.used - b.pending,
    }))
    .filter((e) => e.available < LOW_BALANCE_THRESHOLD_DAYS)
    .sort((a, b) => a.available - b.available);

  // Headcount + who is off right now, per department.
  const offByDept = new Map<string, Set<string>>();
  for (const r of offTodayRequests) {
    const deptId = r.user.departmentId ?? "";
    if (!offByDept.has(deptId)) offByDept.set(deptId, new Set());
    offByDept.get(deptId)!.add(r.userId);
  }
  const departments = allDepartments
    .filter((d: (typeof allDepartments)[number]) =>
      departmentFilter
        ? d.id === departmentFilter
        : scope.kind === "department"
          ? d.id === managerDepartmentId
          : true,
    )
    .map((d: (typeof allDepartments)[number]) => ({
      id: d.id,
      name: d.name,
      total: d._count.users,
      onLeave: offByDept.get(d.id)?.size ?? 0,
    }));

  // Pending requests the viewer can actually act on (delegation + expected
  // approver respected). Filtered to the selected department when one is set.
  const pendingForAction = await listPendingForApproval(user);
  const attentionPending = pendingForAction
    .filter((r: (typeof pendingForAction)[number]) =>
      departmentFilter ? r.user.departmentId === departmentFilter : true,
    )
    .map((r: (typeof pendingForAction)[number]) => ({
      requestId: r.id,
      userName: r.user.name,
      departmentName: r.user.department?.name ?? null,
      leaveTypeName: r.leaveType.name,
      startDate: r.startDate,
      endDate: r.endDate,
    }));

  // Departments with several people absent on the same day, next 14 days.
  const windowStart = today;
  const windowEnd = addDaysISO(today, 13);
  const conflictRequests = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      status: "APPROVED",
      startDate: { lte: windowEnd },
      endDate: { gte: windowStart },
      ...visibleWhere,
      ...(departmentFilter ? { user: { departmentId: departmentFilter } } : {}),
    },
    select: {
      startDate: true,
      endDate: true,
      userId: true,
      user: { select: { departmentId: true, department: { select: { name: true } } } },
    },
  });
  const byDeptDate = new Map<string, Map<string, Set<string>>>();
  for (const r of conflictRequests) {
    const deptName = r.user.department?.name ?? "—";
    const start = r.startDate > windowStart ? r.startDate : windowStart;
    const end = r.endDate < windowEnd ? r.endDate : windowEnd;
    if (!byDeptDate.has(deptName)) byDeptDate.set(deptName, new Map());
    const perDate = byDeptDate.get(deptName)!;
    for (let d = start; d <= end; d = addDaysISO(d, 1)) {
      if (!perDate.has(d)) perDate.set(d, new Set());
      perDate.get(d)!.add(r.userId);
    }
  }
  const conflicts: { departmentName: string; date: string; count: number }[] = [];
  for (const [deptName, perDate] of byDeptDate.entries()) {
    for (const [date, users] of perDate.entries()) {
      if (users.size >= 2) conflicts.push({ departmentName: deptName, date, count: users.size });
    }
  }
  conflicts.sort((a, b) => b.count - a.count || (a.date < b.date ? -1 : 1));

  // Monthly utilisation of approved days for the selected leave year.
  const monthKeys = monthsInRange(selectedYearStart, selectedYearEnd);
  const byMonth = new Map<string, number>();
  for (const r of yearRequests) {
    const key = r.startDate.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.totalDays);
  }
  const monthlyUtilization = monthKeys.map((key) => ({ key, days: byMonth.get(key) ?? 0 }));

  // Leave-year options from real balance rows; the current year is always first.
  const periodRows = await prisma.leaveBalance.findMany({
    where: { companyId },
    select: { periodStart: true },
    distinct: ["periodStart"],
    orderBy: { periodStart: "desc" },
  });
  const yearSet = new Set<string>([currentYear.start, ...periodRows.map((p) => p.periodStart)]);
  const leaveYears = [...yearSet]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((start) => ({ start, year: Number(start.slice(0, 4)) }));

  return {
    scope,
    showDepartmentFilter,
    selectedYearStart,
    currentYearStart: currentYear.start,
    activeEmployees: activeCount,
    offToday,
    pendingCount,
    approvedDays,
    availableToday,
    lowBalanceCount: lowBalances.length,
    lowBalanceThreshold: LOW_BALANCE_THRESHOLD_DAYS,
    departments,
    departmentsForFilter: showDepartmentFilter
      ? allDepartments.map((d: (typeof allDepartments)[number]) => ({ id: d.id, name: d.name }))
      : [],
    offTodayList: offTodayRequests.map((r: (typeof offTodayRequests)[number]) => ({
      requestId: r.id,
      userName: r.user.name,
      departmentName: r.user.department?.name ?? null,
      leaveTypeName: r.leaveType.name,
      leaveTypeColor: r.leaveType.color,
      startDate: r.startDate,
      endDate: r.endDate,
    })),
    attention: {
      pending: attentionPending,
      lowBalances,
      conflicts,
    },
    monthlyUtilization,
    upcoming: upcoming.map((r: (typeof upcoming)[number]) => ({
      requestId: r.id,
      userName: r.user.name,
      departmentName: r.user.department?.name ?? null,
      leaveTypeName: r.leaveType.name,
      leaveTypeColor: r.leaveType.color,
      startDate: r.startDate,
      endDate: r.endDate,
    })),
    leaveYears,
  };
}
