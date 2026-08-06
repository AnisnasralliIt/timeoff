/**
 * Working-day calendar. A working day is any day that is neither a weekend
 * (Saturday/Sunday) nor a holiday. Holidays are supplied as a set of concrete
 * ISO dates; callers resolve recurring holidays before calling these helpers.
 */
import { assertValidRange, eachDay, isValidISODate, parseISO, toISO } from "./dates";

export interface CalendarOptions {
  /** Concrete holiday dates, e.g. resolved from the Holiday table. */
  holidays?: ReadonlySet<string>;
}

export function isWeekendISO(value: string): boolean {
  return parseISO(value).getUTCDay() === 0 || parseISO(value).getUTCDay() === 6;
}

export function isHoliday(value: string, holidays: ReadonlySet<string>): boolean {
  return holidays.has(value);
}

export function isWorkingDay(value: string, options: CalendarOptions = {}): boolean {
  if (isWeekendISO(value)) return false;
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
