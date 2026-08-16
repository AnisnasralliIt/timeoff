/**
 * Calendar + Excel-export data services. Every query is scoped through
 * `getVisibleUserIds` (the single authority for who an actor may see):
 * company-wide roles see the whole company, MANAGER/EMPLOYEE see only their
 * own department. Filtering that bypasses this helper is impossible here —
 * the helper is applied before any department/date filter is honored.
 */
import { prisma, type DayPart, type LeaveRequestStatus } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";
import { getVisibleUserIds } from "@/lib/permissions";
import { LeaveError } from "@/lib/services/leave";
import type {
  CalendarAuthorisation,
  CalendarLeave,
  CalendarRosterMember,
  DayPartValue,
  RequestStatus,
} from "@/lib/calendar-shared";

export interface LeaveQueryOptions {
  from?: string;
  to?: string;
  /** Ignored for non-company-wide roles (their own department is always used). */
  departmentId?: string;
  leaveTypeId?: string;
  statuses: RequestStatus[];
}

const STATUSES: readonly LeaveRequestStatus[] = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

function sanitizeStatuses(statuses: RequestStatus[]): LeaveRequestStatus[] {
  const set = new Set<LeaveRequestStatus>();
  for (const s of statuses) if (STATUSES.includes(s as LeaveRequestStatus)) set.add(s as LeaveRequestStatus);
  return set.size > 0 ? [...set] : ["APPROVED", "PENDING"];
}

interface ScopedLeaveRow {
  id: string;
  startDate: string;
  endDate: string;
  startDayPart: DayPart;
  endDayPart: DayPart;
  totalDays: number;
  status: LeaveRequestStatus;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  rejectionReason: string | null;
  leaveType: { id: string; name: string; color: string };
  user: { id: string; name: string; department: { id: string; name: string } };
  approvedBy: { name: string } | null;
  approvalSteps: { action: LeaveRequestStatus; createdAt: Date; approver: { name: string } | null }[];
}

/**
 * Scoped leave requests for a range/status set. `from`/`to` are optional:
 * when omitted (export everything) the whole history is returned, still
 * scoped to the actor's visibility.
 */
async function findScopedLeaveRequests(
  user: SessionUser,
  opts: LeaveQueryOptions,
): Promise<ScopedLeaveRow[]> {
  const visible = await getVisibleUserIds(user);
  const where: Record<string, unknown> = { companyId: user.companyId };

  let userWhere: Record<string, unknown> | undefined;
  if (visible === "all") {
    if (opts.departmentId) userWhere = { departmentId: opts.departmentId };
  } else {
    userWhere = { id: { in: visible } };
  }
  if (userWhere) where.user = userWhere;
  if (opts.leaveTypeId) where.leaveTypeId = opts.leaveTypeId;
  if (opts.from || opts.to) {
    where.startDate = opts.from ? { lte: opts.to ?? "9999-12-31" } : { lte: opts.to };
    where.endDate = opts.from ? { gte: opts.from } : { gte: "0000-01-01" };
  }
  where.status = { in: sanitizeStatuses(opts.statuses) };

  return prisma.leaveRequest.findMany({
    where,
    include: {
      user: { include: { department: true } },
      leaveType: true,
      approvedBy: { select: { name: true } },
      approvalSteps: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { approver: { select: { name: true } } },
      },
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
}

function toCalendarLeave(row: ScopedLeaveRow): CalendarLeave {
  return {
    id: row.id,
    userId: row.user.id,
    userName: row.user.name,
    departmentId: row.user.department.id,
    departmentName: row.user.department.name,
    leaveTypeId: row.leaveType.id,
    leaveTypeName: row.leaveType.name,
    leaveTypeColor: row.leaveType.color,
    startDate: row.startDate,
    endDate: row.endDate,
    startDayPart: row.startDayPart as DayPartValue,
    endDayPart: row.endDayPart as DayPartValue,
    totalDays: row.totalDays,
    status: row.status as RequestStatus,
    reason: row.reason,
  };
}

/** Calendar feed (bars, list, team view) — always date-bounded. */
export async function listCalendarRequests(
  user: SessionUser,
  opts: LeaveQueryOptions & { from: string; to: string },
): Promise<CalendarLeave[]> {
  const rows = await findScopedLeaveRequests(user, opts);
  return rows.map(toCalendarLeave);
}

/** Active users in scope, for the team-row view roster. */
export async function listCalendarRoster(user: SessionUser): Promise<CalendarRosterMember[]> {
  const visible = await getVisibleUserIds(user);
  const where =
    visible === "all"
      ? { companyId: user.companyId, status: "ACTIVE" as const }
      : { companyId: user.companyId, status: "ACTIVE" as const, id: { in: visible } };
  const rows = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
    },
    orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    name: r.name,
    departmentId: r.departmentId,
    departmentName: r.department.name,
  }));
}

/**
 * Authorisation (time-range) absences for the calendar's optional layer. Only
 * queried when the user explicitly enables the layer; scoped exactly like the
 * leave queries. PENDING/APPROVED only, matching the leave status filter.
 */
export async function listCalendarAuthorisations(
  user: SessionUser,
  from: string,
  to: string,
): Promise<CalendarAuthorisation[]> {
  const visible = await getVisibleUserIds(user);
  const userWhere =
    visible === "all" ? undefined : { id: { in: visible } };
  const rows = await prisma.authorisationRequest.findMany({
    where: {
      companyId: user.companyId,
      status: { in: ["APPROVED", "PENDING"] },
      date: { gte: from, lte: to },
      ...(userWhere ? { user: userWhere } : {}),
    },
    include: {
      user: { include: { department: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    userId: r.user.id,
    userName: r.user.name,
    departmentId: r.user.department.id,
    departmentName: r.user.department.name,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    hours: r.hours,
    status: r.status as RequestStatus,
  }));
}

/** Roles allowed to export (MANAGER + company-wide). EMPLOYEE is denied. */
export function canExport(user: SessionUser): boolean {
  return user.role === "MANAGER" || user.role === "HR" || user.role === "ADMIN" || user.role === "EXECUTIVE" || user.role === "SUPER_ADMIN";
}

export interface ExportRow {
  id: string;
  employee: string;
  department: string;
  leaveType: string;
  leaveTypeColor: string;
  startDate: string;
  endDate: string;
  startDayPart: DayPartValue;
  endDayPart: DayPartValue;
  totalDays: number;
  status: RequestStatus;
  reason: string | null;
  approver: string | null;
  decisionDate: Date | null;
  rejectionReason: string | null;
  submittedAt: Date;
}

function toExportRow(row: ScopedLeaveRow): ExportRow {
  const decidedStep = row.approvalSteps[0];
  return {
    id: row.id,
    employee: row.user.name,
    department: row.user.department.name,
    leaveType: row.leaveType.name,
    leaveTypeColor: row.leaveType.color,
    startDate: row.startDate,
    endDate: row.endDate,
    startDayPart: row.startDayPart as DayPartValue,
    endDayPart: row.endDayPart as DayPartValue,
    totalDays: row.totalDays,
    status: row.status as RequestStatus,
    reason: row.reason,
    approver: row.approvedBy?.name ?? decidedStep?.approver?.name ?? null,
    decisionDate:
      row.status === "APPROVED"
        ? row.approvedAt
        : row.status === "REJECTED"
          ? decidedStep?.createdAt ?? null
          : null,
    rejectionReason: row.rejectionReason,
    submittedAt: row.createdAt,
  };
}

/** Rows for the Excel export, scoped like every other query. */
export async function listExportRows(
  user: SessionUser,
  opts: LeaveQueryOptions,
): Promise<ExportRow[]> {
  if (!canExport(user)) {
    throw new LeaveError("You do not have permission to export leave data.");
  }
  const rows = await findScopedLeaveRequests(user, opts);
  return rows.map(toExportRow);
}
