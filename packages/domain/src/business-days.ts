/**
 * Working-day calendar. A working day is any day that is neither a weekend
 * (Saturday/Sunday) nor a holiday. Holidays are supplied as a set of concrete
 * ISO dates; callers resolve recurring holidays before calling these helpers.
 *
 * When `countWeekendsWithinSpan` is enabled (company-wide leave-duration
 * setting), weekends inside a span count as leave days — only holidays are
 * excluded. `extendWeekendAfterFriday` adds the weekend after a Friday-ending
 * span to the deduction total (see leave-days). Every consumer (span expansion,
 * overlap, previews, exports) reads these options from this one module, so the
 * company settings are always applied consistently.
 */
import { assertValidRange, eachDay, isValidISODate, parseISO, toISO } from "./dates";

export interface CalendarOptions {
  /** Concrete holiday dates, e.g. resolved from the Holiday table. */
  holidays?: ReadonlySet<string>;
  /** Count weekends inside leave spans as leave days (default: false). */
  countWeekendsWithinSpan?: boolean;
  /**
   * Add the following Saturday and Sunday to the deduction total when a span
   * ends on a Friday (default: false). Only affects `totalDays` — the expanded
   * `days` list is never extended, so displayed ranges stay as selected.
   */
  extendWeekendAfterFriday?: boolean;
}

export function isWeekendISO(value: string): boolean {
  return parseISO(value).getUTCDay() === 0 || parseISO(value).getUTCDay() === 6;
}

/** True when the ISO date falls on a Friday. */
export function isFridayISO(value: string): boolean {
  return parseISO(value).getUTCDay() === 5;
}

export function isHoliday(value: string, holidays: ReadonlySet<string>): boolean {
  return holidays.has(value);
}

export function isWorkingDay(value: string, options: CalendarOptions = {}): boolean {
  if (!options.countWeekendsWithinSpan && isWeekendISO(value)) return false;
  return options.holidays ? !isHoliday(value, options.holidays) : true;
}

/** Every working day in `[start, end]`, inclusive, in chronological order. */
export function listBusinessDays(start: string, end: string, options: CalendarOptions = {}): string[] {
  assertValidRange(start, end);
  return eachDay(start, end).filter((day) => isWorkingDay(day, options));
}

/** Number of working days in `[start, end]`, inclusive. */
export function countBusinessDays(start: string, end: string, options: CalendarOptions = {}): number {
  return listBusinessDays(start, end, options).length;
}

/** First working day strictly after `from`. */
export function nextWorkingDay(from: string, options: CalendarOptions = {}): string {
  if (!isValidISODate(from)) throw new RangeError(`Invalid ISO date: ${from}`);
  let cursor = from;
  for (let i = 0; i < 366; i++) {
    cursor = toISO(new Date(parseISO(cursor).getTime() + 86_400_000));
    if (isWorkingDay(cursor, options)) return cursor;
  }
  throw new Error("nextWorkingDay: no working day found within a year");
}
