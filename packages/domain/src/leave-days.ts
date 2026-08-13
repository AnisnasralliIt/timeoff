/**
 * Leave span computation. A leave request spans a date range and consumes a
 * number of *working* days (weekends and holidays are free). The start and end
 * of the span may be half days, which halves the day's cost.
 */
import { assertValidRange, eachDay, isValidISODate } from "./dates";
import { countBusinessDays, isFridayISO, isWorkingDay, type CalendarOptions } from "./business-days";

export type DayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

export interface LeaveSpan {
  startDate: string;
  endDate: string;
  startDayPart?: DayPart;
  endDayPart?: DayPart;
}

export interface ComputedLeaveDay {
  date: string;
  dayPart: DayPart;
}

export interface ComputedLeave {
  days: ComputedLeaveDay[];
  totalDays: number;
}

export class LeaveSpanError extends Error {}

export function dayPartToDays(part: DayPart): 1 | 0.5 {
  return part === "FULL" ? 1 : 0.5;
}

function assertDayPart(value: DayPart | undefined, label: string): void {
  if (value === undefined) return;
  if (value !== "FULL" && value !== "FIRST_HALF" && value !== "SECOND_HALF") {
    throw new LeaveSpanError(`Invalid ${label}: ${String(value)}`);
  }
}

/**
 * Expands a span into per-working-day entries with day parts and the total
 * number of days consumed. Day parts apply to the first and last working days
 * of the span; interior working days are full days.
 *
 * `extendWeekendAfterFriday` adds the two days of the weekend following a
 * Friday-ending span to `totalDays` only — the `days` list is never extended,
 * so displayed ranges always reflect exactly what was selected while the
 * balance deduction (and anything reading `totalDays`) sees the extended cost.
 *
 * @throws LeaveSpanError when the span is invalid or contains no working days.
 */
export function computeLeaveDays(span: LeaveSpan, options: CalendarOptions = {}): ComputedLeave {
  const { startDate, endDate } = span;
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    throw new LeaveSpanError(`Invalid ISO date in span ${startDate}..${endDate}`);
  }
  assertDayPart(span.startDayPart, "startDayPart");
  assertDayPart(span.endDayPart, "endDayPart");
  try {
    assertValidRange(startDate, endDate);
  } catch (error) {
    throw new LeaveSpanError(
      error instanceof Error ? error.message : `Invalid span ${startDate}..${endDate}`,
    );
  }

  const working = eachDay(startDate, endDate).filter((day) => isWorkingDay(day, options));
  if (working.length === 0) {
    throw new LeaveSpanError(`Span ${startDate}..${endDate} contains no working days`);
  }

  const startPart: DayPart = span.startDayPart ?? "FULL";
  const endPart: DayPart = span.endDayPart ?? "FULL";
  const startIsHalf = startPart !== "FULL";
  const endIsHalf = endPart !== "FULL";

  let days: ComputedLeaveDay[];
  if (working.length === 1) {
    if (startIsHalf && endIsHalf && startPart !== endPart) {
      throw new LeaveSpanError("A single working day cannot be split into two half days");
    }
    const singlePart: DayPart = startIsHalf ? startPart : endPart;
    days = [{ date: working[0]!, dayPart: singlePart }];
  } else {
    days = working.map((date, index) => {
      let dayPart: DayPart = "FULL";
      if (index === 0) dayPart = startPart;
      if (index === working.length - 1) dayPart = endPart;
      return { date, dayPart };
    });
  }

  let totalDays = days.reduce((sum, day) => sum + dayPartToDays(day.dayPart), 0);
  // Toggle 2: a Friday-ending span pulls in the following weekend. Applied on
  // top of the selected days, so a multi-week span that already counted an
  // interior weekend never double-counts it (only the weekend after the last
  // day is ever added).
  if (options.extendWeekendAfterFriday && isFridayISO(endDate)) {
    totalDays += 2;
  }
  return { days, totalDays };
}

/** The days a span consumes, keyed by date -> day part (half-day aware). */
export function spanDayMap(span: LeaveSpan, options: CalendarOptions = {}): Map<string, DayPart> {
  const computed = computeLeaveDays(span, options);
  return new Map(computed.days.map((day) => [day.date, day.dayPart]));
}

/** Number of working days a span would consume without half-day reduction. */
export function spanWorkingDays(startDate: string, endDate: string, options: CalendarOptions = {}): number {
  return countBusinessDays(startDate, endDate, options);
}
