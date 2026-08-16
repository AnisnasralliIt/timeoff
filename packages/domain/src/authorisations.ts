/**
 * Authorisations module — a company-wide HR time-off system measured in HOURS
 * with monthly periods, fully independent from the vacation (leave) engine.
 *
 * Rules (all documented; see the module report):
 *  - Every monthly period (`YYYY-MM`) owns one balance row; nothing accumulates
 *    across periods except an explicit, capped carry-over.
 *  - Monthly allowance is granted per period, optionally prorated for the
 *    employee's joining month.
 *  - A request is a single date plus a number of hours validated against the
 *    policy (min / max / increment).
 *  - Carry-over moves the previous period's UNUSED hours into the next period,
 *    capped at the policy limit. 0 unused => 0 carried over; the cap is never
 *    auto-granted.
 *  - Balance formula mirrors the vacation engine:
 *    available = granted + carriedOver + adjustment - used - pending
 */
import { isValidISODate, toISO } from "./dates";

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface AuthorisationPolicyConfig {
  monthlyAllowance: number;
  minRequestHours: number;
  maxRequestHours: number;
  requestIncrementHours: number;
  carryOverEnabled: boolean;
  maxCarryOverHours: number;
  prorateFirstMonth: boolean;
  requiresApproval: boolean;
}

/** Defaults used when no policy row exists yet. */
export const DEFAULT_AUTHORISATION_POLICY: AuthorisationPolicyConfig = {
  monthlyAllowance: 4,
  minRequestHours: 2,
  maxRequestHours: 4,
  requestIncrementHours: 2,
  carryOverEnabled: false,
  maxCarryOverHours: 4,
  prorateFirstMonth: false,
  requiresApproval: true,
};

export const AUTHORISATION_PERIOD_RE = /^\d{4}-\d{2}$/;

export const AUTHORISATION_TIME_RE = /^\d{2}:\d{2}$/;

/** Whether `time` is a valid 24-hour "HH:MM" string (00:00–23:59). */
export function isValidAuthorisationTime(time: string): boolean {
  if (!AUTHORISATION_TIME_RE.test(time)) return false;
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/** Minutes since midnight for a valid "HH:MM" time; null when invalid. */
export function parseAuthorisationTime(time: string): number | null {
  if (!isValidAuthorisationTime(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Formats minutes-since-midnight back to "HH:MM" (clamped to the day). */
export function formatAuthorisationTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Duration in hours between two same-day times. Returns null when either time
 * is invalid or the end is not strictly after the start.
 */
export function authorisationDurationHours(startTime: string, endTime: string): number | null {
  const start = parseAuthorisationTime(startTime);
  const end = parseAuthorisationTime(endTime);
  if (start === null || end === null || end <= start) return null;
  return round2((end - start) / 60);
}

export type AuthorisationTimeRangeError = "invalidStartTime" | "invalidEndTime" | "endNotAfterStart";

/** Validates a same-day time range. Returns null when valid. */
export function validateAuthorisationTimeRange(
  startTime: string,
  endTime: string,
): AuthorisationTimeRangeError | null {
  if (!isValidAuthorisationTime(startTime)) return "invalidStartTime";
  if (!isValidAuthorisationTime(endTime)) return "invalidEndTime";
  if (parseAuthorisationTime(endTime)! <= parseAuthorisationTime(startTime)!) return "endNotAfterStart";
  return null;
}

/**
 * End time adjusted forward so the range lasts at least `minHours`, keeping the
 * START time fixed. Returns the original end time unchanged when it already
 * satisfies the minimum, and null when the adjusted end would not fit before
 * midnight (there is not enough time left in the day).
 */
export function adjustAuthorisationEndToMinimum(
  startTime: string,
  endTime: string,
  minHours: number,
): string | null {
  const start = parseAuthorisationTime(startTime);
  const end = parseAuthorisationTime(endTime);
  if (start === null || end === null || minHours <= 0) return null;
  const target = start + Math.round(minHours * 60);
  if (end >= target) return endTime;
  if (target > 1439) return null;
  return formatAuthorisationTime(target);
}

export function isValidAuthorisationPeriod(period: string): boolean {
  if (!AUTHORISATION_PERIOD_RE.test(period)) return false;
  const month = Number(period.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** The monthly period (`YYYY-MM`) a date belongs to; empty when invalid. */
export function authorisationPeriod(dateISO: string): string {
  return isValidISODate(dateISO) ? dateISO.slice(0, 7) : "";
}

/** Calendar bounds of a monthly period (inclusive ISO dates), or null. */
export function monthBounds(period: string): { start: string; end: string } | null {
  if (!isValidAuthorisationPeriod(period)) return null;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return { start: `${period}-01`, end: toISO(new Date(Date.UTC(year, month, 0))) };
}

/** The period immediately before `period` (e.g. "2026-03" -> "2026-02"). */
export function previousAuthorisationPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export interface AuthorisationBalanceComponents {
  granted: number;
  carriedOver: number;
  adjustment: number;
  used: number;
  pending: number;
}

export function availableAuthorisationHours(balance: AuthorisationBalanceComponents): number {
  return round2(balance.granted + balance.carriedOver + balance.adjustment - balance.used - balance.pending);
}

/**
 * The allowance granted for `period`. Proration rule (documented):
 *  - any period other than the employee's joining month gets the full monthly
 *    allowance;
 *  - the joining month gets the full allowance unless `prorateFirstMonth` is
 *    on, in which case it is scaled by the share of remaining days in the
 *    month starting on (and including) the hire date:
 *    monthlyAllowance × remainingDays / daysInMonth.
 */
export function monthlyAuthorisationAllowance(options: {
  monthlyAllowance: number;
  employmentStartDate: string;
  period: string;
  prorateFirstMonth: boolean;
}): number {
  const { monthlyAllowance, employmentStartDate, period, prorateFirstMonth } = options;
  if (!isValidISODate(employmentStartDate) || !isValidAuthorisationPeriod(period)) return 0;
  if (authorisationPeriod(employmentStartDate) !== period) return round2(monthlyAllowance);
  if (!prorateFirstMonth) return round2(monthlyAllowance);
  const bounds = monthBounds(period);
  if (!bounds) return 0;
  const total = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const remaining =
    Math.round(
      (Date.UTC(Number(bounds.end.slice(0, 4)), Number(bounds.end.slice(5, 7)) - 1, Number(bounds.end.slice(8, 10))) -
        Date.UTC(
          Number(employmentStartDate.slice(0, 4)),
          Number(employmentStartDate.slice(5, 7)) - 1,
          Number(employmentStartDate.slice(8, 10)),
        )) /
        86_400_000,
    ) + 1;
  return round2(monthlyAllowance * (remaining / total));
}

export type AuthorisationHoursError =
  | "notPositive"
  | "belowMinimum"
  | "aboveMaximum"
  | "notIncrement";

/**
 * Validates a requested number of hours against the policy. Returns null when
 * valid. Increment check uses the policy's request increment.
 */
export function validateAuthorisationHours(
  hours: number,
  policy: { minRequestHours: number; maxRequestHours: number; requestIncrementHours: number },
): AuthorisationHoursError | null {
  if (!Number.isFinite(hours) || hours <= 0) return "notPositive";
  if (hours < policy.minRequestHours) return "belowMinimum";
  if (hours > policy.maxRequestHours) return "aboveMaximum";
  const inc = policy.requestIncrementHours;
  if (inc > 0 && Math.abs(hours % inc) > 1e-6) return "notIncrement";
  return null;
}

export type AuthorisationPolicyError =
  | "allowance"
  | "minHours"
  | "maxHoursBelowMin"
  | "increment"
  | "maxCarryOver";

/** Validates an admin-supplied policy configuration. Returns null when valid. */
export function validateAuthorisationPolicy(policy: AuthorisationPolicyConfig): AuthorisationPolicyError | null {
  if (!Number.isFinite(policy.monthlyAllowance) || policy.monthlyAllowance <= 0) return "allowance";
  if (!Number.isFinite(policy.minRequestHours) || policy.minRequestHours <= 0) return "minHours";
  if (!Number.isFinite(policy.maxRequestHours) || policy.maxRequestHours < policy.minRequestHours) {
    return "maxHoursBelowMin";
  }
  if (!Number.isFinite(policy.requestIncrementHours) || policy.requestIncrementHours <= 0) return "increment";
  if (!Number.isFinite(policy.maxCarryOverHours) || policy.maxCarryOverHours < 0) return "maxCarryOver";
  return null;
}

/**
 * The hours carried from the previous period into the next: the previous
 * period's available hours clamped to `[0, maxCarryOverHours]` when carry-over
 * is enabled. 0 unused => 0 carried; the cap is never auto-granted.
 */
export function authorisationCarryOver(
  previousAvailable: number,
  policy: { carryOverEnabled: boolean; maxCarryOverHours: number },
): number {
  if (!policy.carryOverEnabled) return 0;
  if (!Number.isFinite(previousAvailable) || previousAvailable <= 0) return 0;
  return round2(Math.min(previousAvailable, Math.max(0, policy.maxCarryOverHours)));
}

export type AuthorisationStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface AuthorisationBalanceDelta {
  /** Per-hour multiplier applied to the request's hours. */
  pending: number;
  used: number;
}

/**
 * The balance-side effect of moving a request from `from` to `to`, expressed
 * as per-hour multipliers. PENDING reservations are released on reject/cancel;
 * APPROVED usage is released on cancel. Final statuses never un-reserve, and
 * a self-transition is always a no-op.
 */
export function authorisationTransition(
  from: AuthorisationStatus,
  to: AuthorisationStatus,
): AuthorisationBalanceDelta {
  if (from === to) return { pending: 0, used: 0 };
  switch (`${from}->${to}`) {
    case "PENDING->APPROVED":
      return { pending: -1, used: 1 };
    case "PENDING->REJECTED":
    case "PENDING->CANCELLED":
      return { pending: -1, used: 0 };
    case "APPROVED->CANCELLED":
      return { pending: 0, used: -1 };
    default:
      return { pending: 0, used: 0 };
  }
}

/** Whether the status change is a valid, balance-affecting transition. */
export function isAllowedAuthorisationTransition(
  from: AuthorisationStatus,
  to: AuthorisationStatus,
): boolean {
  if (from === to) return true;
  const delta = authorisationTransition(from, to);
  return delta.pending !== 0 || delta.used !== 0;
}
