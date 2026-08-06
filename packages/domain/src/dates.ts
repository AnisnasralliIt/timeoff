/**
 * Date-only helpers. All values are ISO `YYYY-MM-DD` strings representing
 * calendar dates with no timezone component (see DECISIONS.md D-*).
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MS_PER_DAY = 86_400_000;

export function isValidISODate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseISO(value: string): Date {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))));
}

export function toISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysISO(value: string, days: number): string {
  return toISO(new Date(parseISO(value).getTime() + days * MS_PER_DAY));
}

export function todayISO(): string {
  return toISO(new Date());
}

/** Number of calendar days between two dates, inclusive (`start`..`end`). */
export function diffInDays(start: string, end: string): number {
  return Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / MS_PER_DAY) + 1;
}

/** Enumerates every calendar date in `[start, end]`, inclusive. */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const count = diffInDays(start, end);
  for (let i = 0; i < count; i++) {
    days.push(addDaysISO(start, i));
  }
  return days;
}

export function assertValidRange(start: string, end: string): void {
  if (!isValidISODate(start) || !isValidISODate(end)) {
    throw new RangeError(`Invalid ISO date in range ${start}..${end}`);
  }
  if (start > end) {
    throw new RangeError(`Range start ${start} is after end ${end}`);
  }
}
