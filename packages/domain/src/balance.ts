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
 * Pro-rates an annual allotment for an employee hired part-way through the
 * leave year (EU rule: 1/12 of the annual allotment accrues per month of
 * service, the hiring month counting fully). fullTimeRatio scales for
 * part-time contracts.
 */
export function prorateAllotment(options: {
  annualAllotment: number;
  employmentStartDate: string;
  periodStart: string;
  periodEnd: string;
  fullTimeRatio?: number;
}): number {
  const { annualAllotment, employmentStartDate, periodStart, periodEnd } = options;
  const fullTimeRatio = options.fullTimeRatio ?? 1;
  if (!isValidISODate(employmentStartDate) || !isValidISODate(periodStart) || !isValidISODate(periodEnd)) {
    throw new RangeError("Invalid ISO date in prorateAllotment");
  }
  if (employmentStartDate <= periodStart) {
    return round2(annualAllotment * fullTimeRatio);
  }
  const periodMonths =
    (Number(periodEnd.slice(0, 4)) - Number(periodStart.slice(0, 4))) * 12 +
    (Number(periodEnd.slice(5, 7)) - Number(periodStart.slice(5, 7))) +
    1;
  const hiredYear = Number(employmentStartDate.slice(0, 4));
  const hiredMonth = Number(employmentStartDate.slice(5, 7));
  const startYear = Number(periodStart.slice(0, 4));
  const startMonth = Number(periodStart.slice(5, 7));
  const monthsBeforeHire = (hiredYear - startYear) * 12 + (hiredMonth - startMonth);
  const remainingMonths = Math.max(0, periodMonths - monthsBeforeHire);
  const ratio = Math.min(1, remainingMonths / 12);
  return round2(annualAllotment * ratio * fullTimeRatio);
}

/** Accrual model (future): days earned = rate per working day × worked days. */
export function accrualDays(options: { accrualRate: number; workingDays: number }): number {
  return round2(options.accrualRate * options.workingDays);
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
