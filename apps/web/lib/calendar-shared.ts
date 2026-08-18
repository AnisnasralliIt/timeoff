/**
 * Shared calendar/export types + pure helpers. Client-safe: no prisma, no
 * next/* imports — imported by both the server services/routes and the client
 * calendar explorer.
 */

export type DayPartValue = "FULL" | "FIRST_HALF" | "SECOND_HALF";
export type RequestStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface CalendarLeave {
  id: string;
  userId: string;
  userName: string;
  departmentId: string;
  departmentName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeNameEn: string | null;
  leaveTypeNameFr: string | null;
  leaveTypeColor: string;
  startDate: string;
  endDate: string;
  startDayPart: DayPartValue;
  endDayPart: DayPartValue;
  totalDays: number;
  status: RequestStatus;
  reason: string | null;
}

export interface CalendarRosterMember {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
}

/**
 * A single-day authorisation (time-range absence) rendered as a distinct,
 * hour-based layer over the day-based leave calendar. Pending/approved only.
 */
export interface CalendarAuthorisation {
  id: string;
  userId: string;
  userName: string;
  departmentId: string;
  departmentName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  hours: number;
  status: RequestStatus;
}

export interface CalendarApiParams {
  from: string;
  to: string;
  departmentId?: string;
  leaveTypeId?: string;
  statuses: RequestStatus[];
  roster?: boolean;
}

export function isHalfDay(part: DayPartValue): boolean {
  return part === "FIRST_HALF" || part === "SECOND_HALF";
}

/** True when `date` (an ISO day inside the leave span) is a half day. */
export function isHalfDayOn(leave: CalendarLeave, date: string): boolean {
  if (date === leave.startDate && isHalfDay(leave.startDayPart)) return true;
  if (date === leave.endDate && isHalfDay(leave.endDayPart)) return true;
  return false;
}

/**
 * The leave clipped to a contiguous list of view days. Returns the inclusive
 * first/last day-index within `days`, or null when the leave does not touch
 * the range. The clip keeps weekends inside the span (full-duration bars).
 */
export function clipLeaveToDays(
  leave: CalendarLeave,
  days: string[],
): { start: number; end: number } | null {
  const first = days.findIndex((d) => d >= leave.startDate && d <= leave.endDate);
  if (first === -1) return null;
  let last = first;
  for (let i = first + 1; i < days.length; i++) {
    if (days[i]! <= leave.endDate) last = i;
    else break;
  }
  return { start: first, end: last };
}

/** Bar segments for a leave clipped to a view's day array (for half-day edges). */
export interface BarSegment {
  start: number;
  end: number;
  half: boolean;
}

export function leaveSegments(leave: CalendarLeave, days: string[]): BarSegment[] {
  const clip = clipLeaveToDays(leave, days);
  if (!clip) return [];
  const segments: BarSegment[] = [];
  let current: BarSegment | null = null;
  for (let i = clip.start; i <= clip.end; i++) {
    const half = isHalfDayOn(leave, days[i]!);
    if (current && current.half === half && current.end + 1 === i) {
      current.end = i;
    } else {
      current = { start: i, end: i, half };
      segments.push(current);
    }
  }
  return segments;
}

/** A single absence as the input to staffing-overlap analysis. */
export interface AbsenceSpan {
  userId: string;
  startDate: string;
  endDate: string;
  departmentName: string;
}

/** A day on which `count` employees of one department are absent together. */
export interface StaffingWarning {
  departmentName: string;
  date: string;
  count: number;
}

/**
 * Find days where several employees of the same department are absent at the
 * same time, within the given day window. Distinct employees are counted per
 * department per day; days reaching `minCount` (default 3) become warnings,
 * sorted most-staffed first. Client-safe pure function.
 */
export function staffingWarnings(
  absences: AbsenceSpan[],
  days: string[],
  minCount = 3,
): StaffingWarning[] {
  const warnings: StaffingWarning[] = [];
  for (const day of days) {
    const byDepartment = new Map<string, Set<string>>();
    for (const a of absences) {
      if (a.startDate <= day && a.endDate >= day) {
        const users = byDepartment.get(a.departmentName) ?? new Set<string>();
        users.add(a.userId);
        byDepartment.set(a.departmentName, users);
      }
    }
    for (const [departmentName, users] of byDepartment) {
      if (users.size >= minCount) warnings.push({ departmentName, date: day, count: users.size });
    }
  }
  return warnings.sort(
    (a: StaffingWarning, b: StaffingWarning) => b.count - a.count || a.date.localeCompare(b.date),
  );
}

/** Humanized scope label used in export filenames (slugified, safe for paths). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
