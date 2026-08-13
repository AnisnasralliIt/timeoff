/**
 * Leave balance engine (v1 = fixed annual allotment; accrual-ready).
 *
 * available = accrued + carriedOver + adjustment - used - pending
 * `used` = leave already taken, `pending` = approved-future or awaiting
 * approval. Both reduce what the employee can book right now.
 */
import { isValidISODate, toISO } from "./dates";

export interface BalanceComponents {
  accrued: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
}

export function availableBalance(balance: BalanceComponents): number {
  return balance.accrued + balance.carriedOver + balance.adjustment - balance.used - balance.pending;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cumulative statutory accrual as of a calculation date (EU rule: 1/12 of the
 * annual allotment per month of service, the hiring month and the current
 * month each counting fully). Unlike a per-leave-year grant this never
 * resets: every month from `employmentStartDate` through the calculation
 * month adds one monthly instalment, so the accrued balance grows
 * continuously as time passes (e.g. an August 2026 hire has 1.5 days in
 * August, 3 days in September, 4.5 in October — 18 days ÷ 12 per month).
 * fullTimeRatio scales for part-time contracts.
 *
 * The calculation is exactly `annualAllotment ÷ 12 × months of service` and
 * never rounds to a half day (e.g. an 18-day year accrues 1.5 per month, a
 * 25-day year accrues 25/12 per month). Months before employment started
 * never count; months after the calculation date never count.
 */
export function accruedVacationAsOf(options: {
  annualAllotment: number;
  employmentStartDate: string;
  asOf: string;
  fullTimeRatio?: number;
}): number {
  const { annualAllotment, employmentStartDate, asOf } = options;
  const fullTimeRatio = options.fullTimeRatio ?? 1;
  if (!isValidISODate(employmentStartDate) || !isValidISODate(asOf)) {
    throw new RangeError("Invalid ISO date in accruedVacationAsOf");
  }
  if (employmentStartDate > asOf) return 0;
  const months =
    (Number(asOf.slice(0, 4)) - Number(employmentStartDate.slice(0, 4))) * 12 +
    (Number(asOf.slice(5, 7)) - Number(employmentStartDate.slice(5, 7))) +
    1;
  return round2((annualAllotment / 12) * months * fullTimeRatio);
}

/** Accrual model (future): days earned = rate per working day × worked days. */
export function accrualDays(options: { accrualRate: number; workingDays: number }): number {
  return round2(options.accrualRate * options.workingDays);
}

/**
 * The portion of a previous year's leftover that actually carries over: the
 * unused days are clamped to `[0, carryOverLimit]` — an 18-day leftover with a
 * 15-day cap carries 15 (3 forfeited), an 8-day leftover carries all 8, and a
 * negative leftover carries nothing.
 */
export function cappedCarryOver(carryOverLimit: number, leftover: number): number {
  return Math.min(Math.max(0, carryOverLimit), Math.max(0, leftover));
}

/**
 * Resolves a policy's "MM-DD" carry-over deadline to a concrete ISO date in the
 * given leave year. Throws on malformed input so misconfiguration surfaces
 * loudly instead of being silently ignored.
 */
export function carryOverDeadline(year: string | number, mmdd: string): string {
  if (!/^\d{2}-\d{2}$/.test(mmdd)) {
    throw new RangeError(`Carry-over deadline must be MM-DD, got "${mmdd}"`);
  }
  const date = `${year}-${mmdd}`;
  if (!isValidISODate(date)) {
    throw new RangeError(`Carry-over deadline "${mmdd}" is not a valid month-day`);
  }
  return date;
}

/** Days-of-year span for a leave year anchored on a fiscal month (day 1). */
export function leaveYearRange(fiscalYearStartMonth: number, year: number): { start: string; end: string } {
  const month = Math.min(12, Math.max(1, fiscalYearStartMonth));
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endYear = month === 1 ? year : year + 1;
  const endMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0));
  return { start, end: toISO(lastDay) };
}
