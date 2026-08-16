import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUTHORISATION_POLICY,
  authorisationPeriod,
  authorisationCarryOver,
  authorisationTransition,
  availableAuthorisationHours,
  isAllowedAuthorisationTransition,
  isValidAuthorisationPeriod,
  monthBounds,
  monthlyAuthorisationAllowance,
  previousAuthorisationPeriod,
  validateAuthorisationHours,
  validateAuthorisationPolicy,
  type AuthorisationPolicyConfig,
  authorisationDurationHours,
  adjustAuthorisationEndToMinimum,
  formatAuthorisationTime,
  isValidAuthorisationTime,
  parseAuthorisationTime,
  validateAuthorisationTimeRange,
} from "./index";

const POLICY: AuthorisationPolicyConfig = { ...DEFAULT_AUTHORISATION_POLICY };

describe("authorisations: periods", () => {
  it("maps a date to its YYYY-MM period", () => {
    expect(authorisationPeriod("2026-08-16")).toBe("2026-08");
    expect(authorisationPeriod("2026-01-01")).toBe("2026-01");
  });

  it("rejects invalid dates and periods", () => {
    expect(authorisationPeriod("not-a-date")).toBe("");
    expect(isValidAuthorisationPeriod("2026-13")).toBe(false);
    expect(isValidAuthorisationPeriod("2026-00")).toBe(false);
    expect(isValidAuthorisationPeriod("2026-08")).toBe(true);
  });

  it("computes month bounds inclusively", () => {
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2026-08")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(monthBounds("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthBounds("2026-13")).toBeNull();
  });

  it("walks to the previous period across year boundaries", () => {
    expect(previousAuthorisationPeriod("2026-08")).toBe("2026-07");
    expect(previousAuthorisationPeriod("2026-01")).toBe("2025-12");
  });
});

describe("authorisations: feature gate + defaults", () => {
  it("defaults the module to the spec values (OFF, 4/2/4/2, no carry, no proration, approval on)", () => {
    expect(DEFAULT_AUTHORISATION_POLICY).toEqual({
      monthlyAllowance: 4,
      minRequestHours: 2,
      maxRequestHours: 4,
      requestIncrementHours: 2,
      carryOverEnabled: false,
      maxCarryOverHours: 4,
      prorateFirstMonth: false,
      requiresApproval: true,
    });
  });

  it("is deterministic: the same inputs always produce the same allowance (idempotent grant math)", () => {
    const input = {
      monthlyAllowance: 4,
      employmentStartDate: "2026-01-10",
      period: "2026-03",
      prorateFirstMonth: false,
    };
    const first = monthlyAuthorisationAllowance(input);
    const second = monthlyAuthorisationAllowance(input);
    expect(first).toBe(4);
    expect(second).toBe(first);
  });
});

describe("authorisations: monthly allowance", () => {
  it("grants the full monthly allowance for a normal month", () => {
    expect(
      monthlyAuthorisationAllowance({
        monthlyAllowance: 4,
        employmentStartDate: "2026-01-10",
        period: "2026-03",
        prorateFirstMonth: false,
      }),
    ).toBe(4);
  });

  it("grants the full allowance in the joining month when proration is OFF", () => {
    expect(
      monthlyAuthorisationAllowance({
        monthlyAllowance: 4,
        employmentStartDate: "2026-08-16",
        period: "2026-08",
        prorateFirstMonth: false,
      }),
    ).toBe(4);
  });

  it("prorates the joining month by the remaining days when proration is ON", () => {
    // Hired 16 Aug (31-day month): 16 remaining days → 4 × 16/31 ≈ 2.06.
    expect(
      monthlyAuthorisationAllowance({
        monthlyAllowance: 4,
        employmentStartDate: "2026-08-16",
        period: "2026-08",
        prorateFirstMonth: true,
      }),
    ).toBe(2.06);
  });

  it("a hire on day 1 keeps the full allowance even when proration is ON", () => {
    expect(
      monthlyAuthorisationAllowance({
        monthlyAllowance: 4,
        employmentStartDate: "2026-08-01",
        period: "2026-08",
        prorateFirstMonth: true,
      }),
    ).toBe(4);
  });

  it("months after the joining month are never prorated", () => {
    expect(
      monthlyAuthorisationAllowance({
        monthlyAllowance: 4,
        employmentStartDate: "2026-08-16",
        period: "2026-09",
        prorateFirstMonth: true,
      }),
    ).toBe(4);
  });
});

describe("authorisations: request hour validation", () => {
  it("accepts the minimum, the maximum and an in-range increment multiple", () => {
    expect(validateAuthorisationHours(2, POLICY)).toBeNull();
    expect(validateAuthorisationHours(4, POLICY)).toBeNull();
    expect(validateAuthorisationHours(2.5, { ...POLICY, requestIncrementHours: 0.5 })).toBeNull();
  });

  it("rejects non-positive hours", () => {
    expect(validateAuthorisationHours(0, POLICY)).toBe("notPositive");
    expect(validateAuthorisationHours(-2, POLICY)).toBe("notPositive");
  });

  it("rejects hours below the minimum", () => {
    expect(validateAuthorisationHours(1, POLICY)).toBe("belowMinimum");
  });

  it("rejects hours above the maximum", () => {
    expect(validateAuthorisationHours(5, POLICY)).toBe("aboveMaximum");
  });

  it("rejects hours that are not a multiple of the increment", () => {
    expect(validateAuthorisationHours(3, POLICY)).toBe("notIncrement");
  });
});

describe("authorisations: policy validation", () => {
  it("accepts a valid policy", () => {
    expect(validateAuthorisationPolicy(POLICY)).toBeNull();
  });

  it("rejects a non-positive monthly allowance", () => {
    expect(validateAuthorisationPolicy({ ...POLICY, monthlyAllowance: 0 })).toBe("allowance");
  });

  it("rejects a non-positive minimum", () => {
    expect(validateAuthorisationPolicy({ ...POLICY, minRequestHours: 0 })).toBe("minHours");
  });

  it("rejects a maximum below the minimum", () => {
    expect(validateAuthorisationPolicy({ ...POLICY, maxRequestHours: 1 })).toBe("maxHoursBelowMin");
  });

  it("rejects a non-positive increment", () => {
    expect(validateAuthorisationPolicy({ ...POLICY, requestIncrementHours: 0 })).toBe("increment");
  });

  it("rejects a negative carry-over cap", () => {
    expect(validateAuthorisationPolicy({ ...POLICY, maxCarryOverHours: -1 })).toBe("maxCarryOver");
  });
});

describe("authorisations: carry-over", () => {
  it("carries unused hours when enabled and there are unused hours", () => {
    expect(authorisationCarryOver(6, { carryOverEnabled: true, maxCarryOverHours: 4 })).toBe(4);
  });

  it("caps carried hours at the policy limit — the cap is never auto-granted", () => {
    expect(authorisationCarryOver(2, { carryOverEnabled: true, maxCarryOverHours: 4 })).toBe(2);
    expect(authorisationCarryOver(10, { carryOverEnabled: true, maxCarryOverHours: 4 })).toBe(4);
  });

  it("carries nothing when carry-over is disabled", () => {
    expect(authorisationCarryOver(6, { carryOverEnabled: false, maxCarryOverHours: 4 })).toBe(0);
  });

  it("carries nothing when there are no unused hours", () => {
    expect(authorisationCarryOver(0, { carryOverEnabled: true, maxCarryOverHours: 4 })).toBe(0);
    expect(authorisationCarryOver(-1, { carryOverEnabled: true, maxCarryOverHours: 4 })).toBe(0);
  });
});

describe("authorisations: balance math", () => {
  it("computes available = granted + carriedOver + adjustment - used - pending", () => {
    expect(
      availableAuthorisationHours({ granted: 4, carriedOver: 2, adjustment: -1, used: 3, pending: 2 }),
    ).toBe(0);
    expect(
      availableAuthorisationHours({ granted: 4, carriedOver: 0, adjustment: 0, used: 1, pending: 1 }),
    ).toBe(2);
  });

  it("keeps half-hour precision", () => {
    expect(availableAuthorisationHours({ granted: 4, carriedOver: 0.5, adjustment: 0, used: 0, pending: 0 })).toBe(4.5);
  });
});

describe("authorisations: approval transitions", () => {
  it("moves PENDING hours to USED on approval", () => {
    expect(authorisationTransition("PENDING", "APPROVED")).toEqual({ pending: -1, used: 1 });
    expect(isAllowedAuthorisationTransition("PENDING", "APPROVED")).toBe(true);
  });

  it("releases the PENDING reservation on rejection", () => {
    expect(authorisationTransition("PENDING", "REJECTED")).toEqual({ pending: -1, used: 0 });
    expect(isAllowedAuthorisationTransition("PENDING", "REJECTED")).toBe(true);
  });

  it("releases the PENDING reservation on cancellation", () => {
    expect(authorisationTransition("PENDING", "CANCELLED")).toEqual({ pending: -1, used: 0 });
  });

  it("releases USED hours when an approved request is cancelled", () => {
    expect(authorisationTransition("APPROVED", "CANCELLED")).toEqual({ pending: 0, used: -1 });
  });

  it("never double-deducts: a self-transition is a no-op", () => {
    expect(authorisationTransition("PENDING", "PENDING")).toEqual({ pending: 0, used: 0 });
  });

  it("rejects transitions from final statuses", () => {
    expect(isAllowedAuthorisationTransition("REJECTED", "APPROVED")).toBe(false);
    expect(isAllowedAuthorisationTransition("CANCELLED", "APPROVED")).toBe(false);
  });
});

describe("authorisations: time ranges", () => {
  it("parses and formats 24-hour times", () => {
    expect(isValidAuthorisationTime("14:00")).toBe(true);
    expect(isValidAuthorisationTime("00:00")).toBe(true);
    expect(isValidAuthorisationTime("23:30")).toBe(true);
    expect(isValidAuthorisationTime("24:00")).toBe(false);
    expect(isValidAuthorisationTime("14:60")).toBe(false);
    expect(isValidAuthorisationTime("4:00")).toBe(false);
    expect(parseAuthorisationTime("14:00")).toBe(840);
    expect(parseAuthorisationTime("08:30")).toBe(510);
    expect(parseAuthorisationTime("nope")).toBeNull();
    expect(formatAuthorisationTime(840)).toBe("14:00");
    expect(formatAuthorisationTime(510)).toBe("08:30");
    expect(formatAuthorisationTime(0)).toBe("00:00");
    expect(formatAuthorisationTime(1439)).toBe("23:59");
  });

  it("computes the duration between two same-day times", () => {
    expect(authorisationDurationHours("14:00", "16:00")).toBe(2);
    expect(authorisationDurationHours("14:00", "18:00")).toBe(4);
    expect(authorisationDurationHours("14:00", "15:00")).toBe(1);
    expect(authorisationDurationHours("14:00", "17:00")).toBe(3);
    expect(authorisationDurationHours("08:30", "11:00")).toBe(2.5);
  });

  it("returns null when the range is invalid (end before/at start, bad times)", () => {
    expect(authorisationDurationHours("16:00", "14:00")).toBeNull();
    expect(authorisationDurationHours("14:00", "14:00")).toBeNull();
    expect(authorisationDurationHours("bogus", "16:00")).toBeNull();
  });

  it("validates the same-day rule with a clear error", () => {
    expect(validateAuthorisationTimeRange("14:00", "16:00")).toBeNull();
    expect(validateAuthorisationTimeRange("16:00", "14:00")).toBe("endNotAfterStart");
    expect(validateAuthorisationTimeRange("14:00", "14:00")).toBe("endNotAfterStart");
    expect(validateAuthorisationTimeRange("14:00", "zz")).toBe("invalidEndTime");
    expect(validateAuthorisationTimeRange("zz", "16:00")).toBe("invalidStartTime");
  });

  it("extends the END time forward to reach the minimum, keeping the start fixed", () => {
    expect(adjustAuthorisationEndToMinimum("14:00", "15:00", 2)).toBe("16:00");
    expect(adjustAuthorisationEndToMinimum("08:00", "09:00", 2)).toBe("10:00");
    expect(adjustAuthorisationEndToMinimum("14:00", "14:30", 2)).toBe("16:00");
  });

  it("leaves the end unchanged when the range already satisfies the minimum", () => {
    expect(adjustAuthorisationEndToMinimum("14:00", "16:00", 2)).toBe("16:00");
    expect(adjustAuthorisationEndToMinimum("14:00", "18:00", 2)).toBe("18:00");
  });

  it("returns null when the minimum would push past midnight", () => {
    expect(adjustAuthorisationEndToMinimum("23:00", "23:30", 2)).toBeNull();
    expect(adjustAuthorisationEndToMinimum("14:00", "15:00", 0)).toBeNull();
  });
});
