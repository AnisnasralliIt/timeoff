import { describe, it, expect } from "vitest";
import {
  isValidISODate,
  parseISO,
  toISO,
  addDaysISO,
  diffInDays,
  eachDay,
  assertValidRange,
  isWeekendISO,
  isHoliday,
  isWorkingDay,
  listBusinessDays,
  countBusinessDays,
  nextWorkingDay,
  computeLeaveDays,
  spanDayMap,
  rangesOverlap,
  spansOverlap,
  findConflicts,
  availableBalance,
  accruedVacationAsOf,
  accrualDays,
  cappedCarryOver,
  leaveYearRange,
  carryOverDeadline,
  LeaveSpanError,
  type CalendarOptions,
  type LeaveSpan,
} from "./index";

const holidays: ReadonlySet<string> = new Set(["2025-05-01", "2025-12-25", "2025-12-26"]);
const cal: CalendarOptions = { holidays };
const half = (overrides: Partial<LeaveSpan> = {}): LeaveSpan => ({ startDate: "2025-05-05", endDate: "2025-05-09", ...overrides });

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isValidISODate("2025-05-05")).toBe(true);
    expect(isValidISODate("2025-02-29")).toBe(false);
    expect(isValidISODate("2025-13-01")).toBe(false);
    expect(isValidISODate("2025-05-32")).toBe(false);
    expect(isValidISODate("05/05/2025")).toBe(false);
  });

  it("round-trips dates through UTC", () => {
    const d = parseISO("2025-05-05");
    expect(toISO(d)).toBe("2025-05-05");
  });

  it("adds days across month boundaries", () => {
    expect(addDaysISO("2025-05-31", 1)).toBe("2025-06-01");
    expect(addDaysISO("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysISO("2025-05-05", -5)).toBe("2025-04-30");
  });

  it("counts inclusive calendar days", () => {
    expect(diffInDays("2025-05-05", "2025-05-05")).toBe(1);
    expect(diffInDays("2025-05-05", "2025-05-19")).toBe(15);
  });

  it("enumerates each day", () => {
    expect(eachDay("2025-05-05", "2025-05-07")).toEqual(["2025-05-05", "2025-05-06", "2025-05-07"]);
  });

  it("rejects invalid ranges", () => {
    expect(() => assertValidRange("2025-05-10", "2025-05-05")).toThrow(RangeError);
    expect(() => assertValidRange("not-a-date", "2025-05-05")).toThrow(RangeError);
  });
});

describe("business-days", () => {
  it("recognizes weekends", () => {
    expect(isWeekendISO("2025-05-03")).toBe(true);
    expect(isWeekendISO("2025-05-04")).toBe(true);
    expect(isWeekendISO("2025-05-05")).toBe(false);
  });

  it("recognizes holidays", () => {
    expect(isHoliday("2025-05-01", holidays)).toBe(true);
    expect(isWorkingDay("2025-05-01", cal)).toBe(false);
  });

  it("skips weekends and holidays when listing business days", () => {
    const days = listBusinessDays("2025-04-28", "2025-05-09", cal);
    expect(days).toEqual(["2025-04-28", "2025-04-29", "2025-04-30", "2025-05-02", "2025-05-05", "2025-05-06", "2025-05-07", "2025-05-08", "2025-05-09"]);
  });

  it("counts business days", () => {
    expect(countBusinessDays("2025-05-05", "2025-05-09", cal)).toBe(5);
    expect(countBusinessDays("2025-05-03", "2025-05-04")).toBe(0);
  });

  it("finds the next working day across a weekend", () => {
    expect(nextWorkingDay("2025-05-02", {})).toBe("2025-05-05");
    expect(nextWorkingDay("2025-05-02", cal)).toBe("2025-05-05");
  });

  it("nextWorkingDay skips a holiday", () => {
    expect(nextWorkingDay("2025-04-30", cal)).toBe("2025-05-02");
  });

  it("counts weekends when countWeekendsWithinSpan is set", () => {
    const weekends = { holidays, countWeekendsWithinSpan: true };
    expect(listBusinessDays("2025-05-03", "2025-05-05", weekends)).toEqual([
      "2025-05-03",
      "2025-05-04",
      "2025-05-05",
    ]);
    expect(countBusinessDays("2025-05-03", "2025-05-04", { countWeekendsWithinSpan: true })).toBe(2);
  });

  it("keeps holidays excluded even when weekends count", () => {
    const weekends = { holidays, countWeekendsWithinSpan: true };
    expect(listBusinessDays("2025-05-01", "2025-05-03", weekends)).toEqual(["2025-05-02", "2025-05-03"]);
  });
});

describe("leave-days", () => {
  it("computes a plain working week", () => {
    const { days, totalDays } = computeLeaveDays(half(), cal);
    expect(days).toHaveLength(5);
    expect(days.every((d) => d.dayPart === "FULL")).toBe(true);
    expect(totalDays).toBe(5);
  });

  it("skips weekends and holidays inside the span", () => {
    const span: LeaveSpan = { startDate: "2025-05-01", endDate: "2025-05-06" };
    const { days, totalDays } = computeLeaveDays(span, cal);
    expect(days.map((d) => d.date)).toEqual(["2025-05-02", "2025-05-05", "2025-05-06"]);
    expect(totalDays).toBe(3);
  });

  it("applies half days to first and last working days", () => {
    const span: LeaveSpan = { startDate: "2025-05-05", endDate: "2025-05-09", startDayPart: "FIRST_HALF", endDayPart: "SECOND_HALF" };
    const { days, totalDays } = computeLeaveDays(span, cal);
    expect(days[0]).toEqual({ date: "2025-05-05", dayPart: "FIRST_HALF" });
    expect(days.at(-1)).toEqual({ date: "2025-05-09", dayPart: "SECOND_HALF" });
    expect(days[1]!.dayPart).toBe("FULL");
    expect(totalDays).toBe(4);
  });

  it("adjusts boundary parts when the raw start is a weekend", () => {
    const span: LeaveSpan = { startDate: "2025-05-03", endDate: "2025-05-09", startDayPart: "SECOND_HALF" };
    const { days } = computeLeaveDays(span, cal);
    expect(days[0]).toEqual({ date: "2025-05-05", dayPart: "SECOND_HALF" });
  });

  it("handles a single half day", () => {
    const span: LeaveSpan = { startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "FIRST_HALF" };
    expect(computeLeaveDays(span, cal).totalDays).toBe(0.5);
  });

  it("rejects splitting a single day into two half days", () => {
    const span: LeaveSpan = { startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "FIRST_HALF", endDayPart: "SECOND_HALF" };
    expect(() => computeLeaveDays(span, cal)).toThrow(LeaveSpanError);
  });

  it("rejects a span with no working days", () => {
    expect(() => computeLeaveDays({ startDate: "2025-05-03", endDate: "2025-05-04" }, cal)).toThrow(LeaveSpanError);
  });

  it("rejects invalid or reversed spans", () => {
    expect(() => computeLeaveDays({ startDate: "bad", endDate: "2025-05-05" })).toThrow(LeaveSpanError);
    expect(() => computeLeaveDays({ startDate: "2025-05-09", endDate: "2025-05-05" })).toThrow(LeaveSpanError);
  });

  it("builds a day map keyed by date", () => {
    const map = spanDayMap(half({ startDayPart: "FIRST_HALF" }), cal);
    expect(map.get("2025-05-05")).toBe("FIRST_HALF");
    expect(map.get("2025-05-06")).toBe("FULL");
    expect(map.size).toBe(5);
  });

  it("counts weekends inside the span when enabled", () => {
    const span: LeaveSpan = { startDate: "2025-05-01", endDate: "2025-05-06" };
    const { days, totalDays } = computeLeaveDays(span, { holidays, countWeekendsWithinSpan: true });
    expect(days.map((d) => d.date)).toEqual(["2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05", "2025-05-06"]);
    expect(totalDays).toBe(5);
  });

  it("allows a weekend-only span when weekends count", () => {
    expect(computeLeaveDays({ startDate: "2025-05-03", endDate: "2025-05-04" }, { countWeekendsWithinSpan: true }).totalDays).toBe(2);
  });

  // Weekday anchor for the weekend-toggle matrix: 2026-08-03 is a Monday.
  const SPAN_ONE_WEEK = { startDate: "2026-08-03", endDate: "2026-08-07" }; // Mon → Fri
  const SPAN_TWO_WEEKS = { startDate: "2026-08-03", endDate: "2026-08-10" }; // Mon → Mon (interior Sat 8/8 + Sun 8/9)
  const SPAN_TWO_WEEKS_FRIDAY = { startDate: "2026-08-03", endDate: "2026-08-14" }; // Mon → Fri (interior + trailing weekend)
  const opts = { countWeekendsWithinSpan: false, extendWeekendAfterFriday: false };

  it("toggle matrix: both off — weekends never count", () => {
    expect(computeLeaveDays(SPAN_ONE_WEEK, opts).totalDays).toBe(5);
    expect(computeLeaveDays(SPAN_TWO_WEEKS, opts).totalDays).toBe(6);
  });

  it("toggle matrix: countWeekendsWithinSpan only — interior weekends count", () => {
    const o = { ...opts, countWeekendsWithinSpan: true };
    const res = computeLeaveDays(SPAN_TWO_WEEKS, o);
    expect(res.days).toHaveLength(8); // Mon–Sun
    expect(res.totalDays).toBe(8);
    expect(computeLeaveDays(SPAN_ONE_WEEK, o).totalDays).toBe(5); // no interior weekend
  });

  it("toggle matrix: extendWeekendAfterFriday only — Friday end pulls the weekend", () => {
    const o = { ...opts, extendWeekendAfterFriday: true };
    const res = computeLeaveDays(SPAN_ONE_WEEK, o);
    expect(res.days).toHaveLength(5); // bar shows only selected days
    expect(res.totalDays).toBe(7); // 5 selected + following Sat/Sun
    // Ends Monday: no extension.
    expect(computeLeaveDays(SPAN_TWO_WEEKS, o).totalDays).toBe(6);
  });

  it("toggle matrix: both on — and no double-counting of one weekend", () => {
    const o = { ...opts, countWeekendsWithinSpan: true, extendWeekendAfterFriday: true };
    const oneWeek = computeLeaveDays(SPAN_ONE_WEEK, o);
    expect(oneWeek.days).toHaveLength(5);
    expect(oneWeek.totalDays).toBe(7); // 5 + weekend after Friday

    // Mon → Fri across two weeks: interior weekend (8/8–8/9) counted once,
    // trailing weekend (8/15–8/16) added separately — never the same weekend twice.
    const multiWeek = computeLeaveDays(SPAN_TWO_WEEKS_FRIDAY, o);
    expect(multiWeek.days).toHaveLength(12); // Aug 3–14 inclusive
    expect(multiWeek.days.some((d) => d.date === "2026-08-15" || d.date === "2026-08-16")).toBe(false);
    expect(multiWeek.totalDays).toBe(14); // 12 in-span days + 2 trailing
  });

  it("extendWeekendAfterFriday never prepends a weekend (no reverse case)", () => {
    const o = { ...opts, extendWeekendAfterFriday: true };
    // Monday start, Wednesday end → nothing added before the start.
    expect(computeLeaveDays({ startDate: "2026-08-10", endDate: "2026-08-12" }, o).totalDays).toBe(3);
    // Single Friday off still pulls the weekend.
    expect(computeLeaveDays({ startDate: "2026-08-07", endDate: "2026-08-07" }, o).totalDays).toBe(3);
  });
});

describe("overlap", () => {
  it("detects intersecting ranges", () => {
    expect(rangesOverlap("2025-05-05", "2025-05-09", "2025-05-08", "2025-05-12")).toBe(true);
    expect(rangesOverlap("2025-05-05", "2025-05-07", "2025-05-08", "2025-05-12")).toBe(false);
  });

  it("detects full-day conflicts", () => {
    const a = half();
    const b = half({ startDate: "2025-05-08", endDate: "2025-05-12" });
    const res = spansOverlap(a, b, cal);
    expect(res.dates).toEqual(["2025-05-08", "2025-05-09"]);
  });

  it("treats complementary half days as non-conflicting", () => {
    const a = half({ startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "FIRST_HALF" });
    const b = half({ startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "SECOND_HALF" });
    expect(spansOverlap(a, b, cal).overlappingDays).toBe(0);
  });

  it("treats same-half or half+full as conflicting", () => {
    const sameHalfA = half({ startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "FIRST_HALF" });
    const sameHalfB = half({ startDate: "2025-05-05", endDate: "2025-05-05", startDayPart: "FIRST_HALF" });
    expect(spansOverlap(sameHalfA, sameHalfB, cal).overlappingDays).toBe(1);

    const full = half({ startDate: "2025-05-05", endDate: "2025-05-05" });
    expect(spansOverlap(sameHalfA, full, cal).overlappingDays).toBe(1);
  });

  it("finds conflict pairs in a list", () => {
    const spans = [
      { id: "a", span: half() },
      { id: "b", span: half({ startDate: "2025-05-07", endDate: "2025-05-12" }) },
      { id: "c", span: half({ startDate: "2025-05-13", endDate: "2025-05-16" }) },
    ];
    const conflicts = findConflicts(spans, cal);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.a).toBe("a");
    expect(conflicts[0]!.b).toBe("b");
  });

  it("detects weekend conflicts when weekends count", () => {
    const a = half({ startDate: "2025-05-02", endDate: "2025-05-04" });
    const b = half({ startDate: "2025-05-04", endDate: "2025-05-05" });
    const weekends = { holidays, countWeekendsWithinSpan: true };
    expect(spansOverlap(a, b, cal).overlappingDays).toBe(0);
    expect(spansOverlap(a, b, weekends).overlappingDays).toBe(1);
  });
});

describe("balance", () => {
  it("computes available balance", () => {
    const b = { accrued: 30, carriedOver: 5, adjustment: -2, used: 12, pending: 3 };
    expect(availableBalance(b)).toBe(18);
  });

  it("grants exactly one monthly instalment to a current-month hire (mandatory §14 T1/T3)", () => {
    // 18 days/year → 1.5/month; 24 days/year → 2/month. As of August 2026 an
    // August 2026 hire has 1 eligible month.
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-08-01", asOf: "2026-08-11" })).toBeCloseTo(1.5, 5);
    expect(accruedVacationAsOf({ annualAllotment: 24, employmentStartDate: "2026-08-01", asOf: "2026-08-11" })).toBeCloseTo(2, 5);
  });

  it("accrues cumulatively from the hiring month with no annual reset (mandatory §14 T2/T4/T6)", () => {
    // December 2025 hire as of August 2026: Dec 2025 + Jan–Aug 2026 = 9 months.
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2025-12-01", asOf: "2026-08-11" })).toBeCloseTo(13.5, 5);
    expect(accruedVacationAsOf({ annualAllotment: 24, employmentStartDate: "2025-12-01", asOf: "2026-08-11" })).toBeCloseTo(18, 5);
    // Crosses the year boundary without resetting: Dec 2025 → Jan 2026 keeps counting.
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2025-12-01", asOf: "2025-12-15" })).toBeCloseTo(1.5, 5);
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2025-12-01", asOf: "2026-01-15" })).toBeCloseTo(3, 5);
  });

  it("never counts months before employment started (mandatory §14 T5)", () => {
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-08-01", asOf: "2026-07-31" })).toBe(0);
    expect(accruedVacationAsOf({ annualAllotment: 24, employmentStartDate: "2026-08-15", asOf: "2026-08-01" })).toBe(0);
  });

  it("counts the hiring month fully even for a mid-month start (existing rule)", () => {
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-06-15", asOf: "2026-06-30" })).toBeCloseTo(1.5, 5);
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-06-15", asOf: "2026-07-31" })).toBeCloseTo(3, 5);
  });

  it("never grants a full-year entitlement to a recent hire", () => {
    // Two months of service → two monthly instalments, not the annual grant.
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-07-01", asOf: "2026-08-31" })).toBeCloseTo(3, 5);
    expect(accruedVacationAsOf({ annualAllotment: 30, employmentStartDate: "2026-07-01", asOf: "2026-08-31" })).toBeCloseTo(5, 5);
    // Only after 12 full months of service does the balance reach the annual allotment.
    expect(accruedVacationAsOf({ annualAllotment: 18, employmentStartDate: "2026-01-01", asOf: "2026-12-31" })).toBeCloseTo(18, 5);
  });

  it("computes the exact monthly accrual (no half-day rounding)", () => {
    // Hired June, as of December: 7 months. 27 × 7/12 = 15.75; 25 × 7/12 ≈ 14.583.
    expect(accruedVacationAsOf({ annualAllotment: 27, employmentStartDate: "2025-06-01", asOf: "2025-12-31" })).toBeCloseTo(15.75, 5);
    expect(accruedVacationAsOf({ annualAllotment: 25, employmentStartDate: "2025-06-01", asOf: "2025-12-31" })).toBeCloseTo(14.58, 5);
  });

  it("scales by part-time ratio", () => {
    // 3 months × 30/12 × 0.5 = 3.75.
    const result = accruedVacationAsOf({ annualAllotment: 30, employmentStartDate: "2025-07-01", asOf: "2025-09-30", fullTimeRatio: 0.5 });
    expect(result).toBeCloseTo(3.75, 5);
  });

  it("accrues at exactly 1.5 days/month for 18-day and 2 days/month for 24-day policies (report §5)", () => {
    expect(18 / 12).toBeCloseTo(1.5, 5);
    expect(24 / 12).toBeCloseTo(2, 5);
  });

  it("computes accrual days from a rate", () => {
    expect(accrualDays({ accrualRate: 0.1, workingDays: 220 })).toBe(22);
  });

  it("computes leave-year ranges", () => {
    expect(leaveYearRange(1, 2025)).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(leaveYearRange(4, 2025)).toEqual({ start: "2025-04-01", end: "2026-03-31" });
  });

  it("resolves a carry-over deadline to a concrete date in a year", () => {
    expect(carryOverDeadline(2026, "03-31")).toBe("2026-03-31");
    expect(carryOverDeadline("2027", "12-31")).toBe("2027-12-31");
  });

  it("rejects malformed carry-over deadlines", () => {
    expect(() => carryOverDeadline(2026, "13-01")).toThrow(RangeError);
    expect(() => carryOverDeadline(2026, "03-32")).toThrow(RangeError);
    expect(() => carryOverDeadline(2026, "3-1")).toThrow(RangeError);
    expect(() => carryOverDeadline(2026, "bogus")).toThrow(RangeError);
  });

  it("caps carried-over days at the configured limit (extra forfeited)", () => {
    expect(cappedCarryOver(15, 18)).toBe(15);
    expect(cappedCarryOver(10, 18)).toBe(10);
  });

  it("carries the full leftover when it is under the cap", () => {
    expect(cappedCarryOver(15, 8)).toBe(8);
    expect(cappedCarryOver(15, 0)).toBe(0);
  });

  it("never carries a negative leftover and a zero limit carries nothing", () => {
    expect(cappedCarryOver(15, -3)).toBe(0);
    expect(cappedCarryOver(0, 8)).toBe(0);
  });
});
