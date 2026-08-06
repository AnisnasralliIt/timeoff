/**
 * Overlap detection between leave spans. Two spans conflict only if they share
 * at least one working day with overlapping day parts. A FIRST_HALF and a
 * SECOND_HALF on the same day complement each other and do not conflict.
 */
import type { CalendarOptions } from "./business-days";
import type { LeaveSpan } from "./leave-days";
import { spanDayMap } from "./leave-days";

export interface OverlapResult {
  dates: string[];
  overlappingDays: number;
}

/**
 * True when the inclusive date ranges intersect. ISO string comparison is
 * safe for YYYY-MM-DD values.
 */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function partsConflict(a: string, b: string): boolean {
  if (a === "FULL" || b === "FULL") return true;
  return a === b;
}

/**
 * Half-day aware overlap. Returns the shared conflicting working dates, or an
 * empty array when the spans do not conflict.
 */
export function spansOverlap(a: LeaveSpan, b: LeaveSpan, options: CalendarOptions = {}): OverlapResult {
  const aDays = spanDayMap(a, options);
  const bDays = spanDayMap(b, options);
  const conflicts: string[] = [];
  for (const [date, aPart] of aDays) {
    const bPart = bDays.get(date);
    if (bPart !== undefined && partsConflict(aPart, bPart)) {
      conflicts.push(date);
    }
  }
  return { dates: conflicts, overlappingDays: conflicts.length };
}

/** Finds conflicting pairs among a list of spans. */
export function findConflicts(
  spans: Array<{ id: string; span: LeaveSpan }>,
  options: CalendarOptions = {},
): Array<{ a: string; b: string; overlap: OverlapResult }> {
  const conflicts: Array<{ a: string; b: string; overlap: OverlapResult }> = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const left = spans[i]!;
      const right = spans[j]!;
      if (!rangesOverlap(left.span.startDate, left.span.endDate, right.span.startDate, right.span.endDate)) continue;
      const overlap = spansOverlap(left.span, right.span, options);
      if (overlap.overlappingDays > 0) {
        conflicts.push({ a: left.id, b: right.id, overlap });
      }
    }
  }
  return conflicts;
}
