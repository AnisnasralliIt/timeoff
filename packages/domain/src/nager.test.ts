import { describe, it, expect } from "vitest";
import {
  parseNagerResponse,
  normalizeCountryCode,
  validateNagerYear,
  isNationalOrPublic,
  defaultSelectedDates,
  buildImportPlan,
  NagerError,
  type NagerHoliday,
} from "./index";

/** Official-shaped Nager.Date v4 entries. */
const tnHolidays: NagerHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day", countryCode: "TN", global: true, types: ["Public"] },
  { date: "2026-03-20", name: "Independence Day", countryCode: "TN", global: true, types: ["Public"] },
  { date: "2026-04-09", name: "Martyrs' Day", countryCode: "TN", global: true, types: ["Public"] },
  { date: "2026-07-25", name: "Republic Day", countryCode: "TN", global: true, types: ["Public"] },
  { date: "2026-06-20", name: "Summer Solstice", countryCode: "TN", global: false, types: ["Observance"] },
  { date: "2026-05-01", name: "Labour Day", countryCode: "TN", global: false, types: ["Public"] },
  { date: "2026-09-01", name: "Bank Holiday", countryCode: "TN", global: false, types: ["Bank"] },
];

describe("Nager.Date — validation", () => {
  it("accepts and normalizes a valid country code", () => {
    expect(normalizeCountryCode("tn")).toBe("TN");
    expect(normalizeCountryCode("  DE ")).toBe("DE");
  });

  it("rejects invalid country codes", () => {
    for (const bad of ["", "TUN", "T", "TN1", "🦄", "12"]) {
      expect(() => normalizeCountryCode(bad)).toThrow(NagerError);
      expect(() => normalizeCountryCode(bad)).toThrow(/country code/i);
    }
  });

  it("accepts past, current and future years within the app range", () => {
    expect(validateNagerYear(2024)).toBe(2024);
    expect(validateNagerYear(2026)).toBe(2026);
    expect(validateNagerYear(2027)).toBe(2027);
  });

  it("rejects invalid years", () => {
    for (const bad of [0, 1899, 2101, 2026.5, NaN, -5]) {
      expect(() => validateNagerYear(bad)).toThrow(NagerError);
    }
  });

  it("rejects a non-array payload", () => {
    for (const bad of [{}, null, "holidays", 42, { data: [] }]) {
      expect(() => parseNagerResponse(bad)).toThrow(NagerError);
    }
  });

  it("rejects entries with missing required fields", () => {
    expect(() => parseNagerResponse([{ name: "X", countryCode: "TN", types: [] }])).toThrow(NagerError);
    expect(() => parseNagerResponse([{ date: "2026-01-01", countryCode: "TN", types: [] }])).toThrow(NagerError);
    expect(() => parseNagerResponse([{ date: "2026-01-01", name: "X", types: [] }])).toThrow(NagerError);
  });

  it("rejects invalid dates and malformed types/global", () => {
    expect(() => parseNagerResponse([{ date: "2026-13-40", name: "X", countryCode: "TN" }])).toThrow(NagerError);
    expect(() => parseNagerResponse([{ date: "01/01/2026", name: "X", countryCode: "TN" }])).toThrow(NagerError);
    expect(() => parseNagerResponse([{ date: "2026-01-01", name: "X", countryCode: "TN", types: "Public" }])).toThrow(NagerError);
    expect(() => parseNagerResponse([{ date: "2026-01-01", name: "X", countryCode: "TN", global: "yes" }])).toThrow(NagerError);
  });
});

describe("Nager.Date — parsing", () => {
  it("parses the official response shape (correct parsing)", () => {
    const parsed = parseNagerResponse(
      tnHolidays.map((h) => ({ ...h, localName: `${h.name} (local)` })),
    );
    expect(parsed).toHaveLength(tnHolidays.length);
    expect(parsed[0]).toMatchObject({
      date: "2026-01-01",
      name: "New Year's Day",
      countryCode: "TN",
      global: true,
      types: ["Public"],
    });
    expect(parsed[0]?.localName).toBe("New Year's Day (local)");
  });

  it("falls back to the local name when the international name is absent", () => {
    const [h] = parseNagerResponse([{ date: "2026-01-01", localName: "Neujahr", countryCode: "DE", types: ["Public"] }]);
    expect(h?.name).toBe("Neujahr");
  });

  it("defaults optional fields", () => {
    const [h] = parseNagerResponse([{ date: "2026-01-01", name: "X", countryCode: "DE" }]);
    expect(h?.types).toEqual([]);
    expect(h?.global).toBeUndefined();
  });
});

describe("Nager.Date — public/national filtering", () => {
  it("selects national and public holidays by default", () => {
    expect(isNationalOrPublic(tnHolidays[0]!)).toBe(true); // national + public
    expect(isNationalOrPublic(tnHolidays[5]!)).toBe(true); // regional public (global false)
    expect(isNationalOrPublic(tnHolidays[4]!)).toBe(false); // observance
    expect(isNationalOrPublic(tnHolidays[6]!)).toBe(false); // bank
  });

  it("defaultSelectedDates returns only national/public dates", () => {
    expect(defaultSelectedDates(tnHolidays)).toEqual([
      "2026-01-01",
      "2026-03-20",
      "2026-04-09",
      "2026-07-25",
      "2026-05-01",
    ]);
  });
});

describe("Nager.Date — import plan", () => {
  it("plans creation of new holidays and keeps existing untouched", () => {
    const existing = new Set(["2026-01-01", "2026-03-20"]); // New Year + Independence already present
    const plan = buildImportPlan(tnHolidays, defaultSelectedDates(tnHolidays), existing);
    expect(plan.selected.map((h) => h.date)).toEqual(["2026-01-01", "2026-03-20", "2026-04-09", "2026-07-25", "2026-05-01"]);
    expect(plan.existing.map((h) => h.date)).toEqual(["2026-01-01", "2026-03-20"]);
    expect(plan.toCreate.map((h) => h.date)).toEqual(["2026-04-09", "2026-07-25", "2026-05-01"]);
    expect(plan.skipped).toEqual([]);
  });

  it("is idempotent: a second identical import creates nothing", () => {
    const existing = new Set(defaultSelectedDates(tnHolidays));
    const plan = buildImportPlan(tnHolidays, defaultSelectedDates(tnHolidays), existing);
    expect(plan.toCreate).toEqual([]);
    expect(plan.existing).toHaveLength(5);
  });

  it("supports manual deselection of individual entries", () => {
    const selected = ["2026-03-20", "2026-04-09"];
    const plan = buildImportPlan(tnHolidays, selected, new Set());
    expect(plan.toCreate.map((h) => h.date)).toEqual(["2026-03-20", "2026-04-09"]);
  });

  it("flags selected dates missing from the fetched set as skipped", () => {
    const plan = buildImportPlan(tnHolidays, ["2026-12-31", "2026-04-09"], new Set());
    expect(plan.skipped).toEqual(["2026-12-31"]);
    expect(plan.toCreate.map((h) => h.date)).toEqual(["2026-04-09"]);
  });
});
