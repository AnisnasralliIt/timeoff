/** Pure date helpers shared by the date-range picker and calendar components. */

export type ISODate = string; // "YYYY-MM-DD"

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: ISODate): Date {
  // Parse as local date, not UTC.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISODate(a) === toISODate(b);
}

/** Inclusive day count between two dates. */
export function daySpan(start: Date, end: Date): number {
  return Math.round(
    (fromISODate(toISODate(end)).getTime() -
      fromISODate(toISODate(start)).getTime()) /
      86_400_000
  ) + 1;
}

export interface MonthGrid {
  /** ISO dates for each cell, in week rows (Mon-first), padded with nulls. */
  cells: (ISODate | null)[];
  monthLabel: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Monday-first grid for the given month (1 = Jan). */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(year, month - 1, 1);
  // JS getDay(): 0 = Sunday. Convert to Mon-first index.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (ISODate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toISODate(new Date(year, month - 1, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return {
    cells,
    monthLabel: `${MONTHS[month - 1]} ${year}`,
  };
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export { MONTHS, WEEKDAYS };
