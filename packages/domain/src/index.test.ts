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
  prorateAllotment,
  accrualDays,
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
});

describe("balance", () => {
  it("computes available balance", () => {
    const b = { accrued: 30, carriedOver: 5, adjustment: -2, used: 12, pending: 3 };
    expect(availableBalance(b)).toBe(18);
  });

  it("returns full allotment when hired before the leave year", () => {
    expect(prorateAllotment({ annualAllotment: 30, employmentStartDate: "2024-06-01", periodStart: "2025-01-01", periodEnd: "2025-12-31" })).toBe(30);
  });

  it("prorates for a mid-year hire", () => {
    const result = prorateAllotment({ annualAllotment: 30, employmentStartDate: "2025-07-01", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
    expect(result).toBeCloseTo(15, 5);
  });

  it("scales by part-time ratio", () => {
    const result = prorateAllotment({ annualAllotment: 30, employmentStartDate: "2025-07-01", periodStart: "2025-01-01", periodEnd: "2025-12-31", fullTimeRatio: 0.5 });
    expect(result).toBeCloseTo(7.5, 5);
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
});
