/**
 * Nager.Date public-holiday integration — pure parsing/validation/filtering.
 * This module holds NO network or database access; the HTTP fetch lives in
 * apps/web (server-only), which feeds raw payloads into `parseNagerResponse`.
 *
 * The API contract used here is the official Nager.Date v4 public holiday
 * shape: an array of `{ date, localName, name, countryCode, fixed, global,
 * counties, launchYear, types }`. We only rely on the fields we display and
 * store. `global === true` means the holiday applies nationwide (displayed as
 * "National" in the UI); `types` is an array such as `["Public"]`.
 */
import { isValidISODate } from "./dates";

export interface NagerHoliday {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** International English name (falls back to the local name). */
  name: string;
  /** Localized name from the API, when present. */
  localName?: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** The holiday is on a fixed month/day every year. */
  fixed?: boolean;
  /** Nationwide (used as the "national" indicator). */
  global?: boolean;
  /** Nager holiday types, e.g. ["Public"], ["Bank", "School"]. */
  types: string[];
}

/** Holiday types Nager.Date may return. Public/national are selected by default. */
export const NAGER_HOLIDAY_TYPES = [
  "Public",
  "Bank",
  "School",
  "Authorities",
  "Optional",
  "Observance",
] as const;

/** Stable error for Nager parsing/validation failures. `code` maps to a locale key. */
export class NagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "NagerError";
  }
}

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
/** Reasonable app rule for importable years (Nager data is available in this range). */
const MIN_IMPORT_YEAR = 1900;
const MAX_IMPORT_YEAR = 2100;

/** Trims/uppercases and validates an ISO 3166-1 alpha-2 country code. */
export function normalizeCountryCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!COUNTRY_CODE_RE.test(code)) {
    throw new NagerError("Invalid country code.", "nagerInvalidCountry");
  }
  return code;
}

/** Validates an import year (integer, 1900–2100). */
export function validateNagerYear(value: number): number {
  if (!Number.isInteger(value) || value < MIN_IMPORT_YEAR || value > MAX_IMPORT_YEAR) {
    throw new NagerError("Invalid year.", "nagerInvalidYear");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validates and normalizes a raw Nager.Date v4 response body.
 * Throws `NagerError` ("invalidData") when the payload is not a well-formed
 * holiday array or any entry misses a required field / uses an invalid date.
 */
export function parseNagerResponse(payload: unknown): NagerHoliday[] {
  if (!Array.isArray(payload)) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  return payload.map((item) => parseNagerHoliday(item));
}

function parseNagerHoliday(item: unknown): NagerHoliday {
  if (!isRecord(item)) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  const { date, name, countryCode, types, global, fixed, localName } = item;
  if (typeof date !== "string" || !isValidISODate(date)) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  const displayName = typeof name === "string" && name.length > 0 ? name : localName;
  if (typeof displayName !== "string" || displayName.length === 0) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  if (typeof countryCode !== "string" || !COUNTRY_CODE_RE.test(countryCode)) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  if (types !== undefined && !isStringArray(types)) {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  if (global !== undefined && typeof global !== "boolean") {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  if (fixed !== undefined && typeof fixed !== "boolean") {
    throw new NagerError("Invalid holiday data received.", "nagerInvalidData");
  }
  return {
    date,
    name: displayName,
    localName: typeof localName === "string" ? localName : undefined,
    countryCode,
    fixed: typeof fixed === "boolean" ? fixed : undefined,
    global: typeof global === "boolean" ? global : undefined,
    types: types ?? [],
  };
}

/**
 * Default selection rule (§13): select a holiday when it is nationwide
 * (`global === true`) or its types include "Public". Observance/Optional/
 * School/Bank entries are left deselected for the administrator to opt in.
 */
export function isNationalOrPublic(holiday: NagerHoliday): boolean {
  return holiday.global === true || holiday.types.includes("Public");
}

/** Default selection: the dates of all national/public holidays, in API order. */
export function defaultSelectedDates(holidays: readonly NagerHoliday[]): string[] {
  return holidays.filter((h) => isNationalOrPublic(h)).map((h) => h.date);
}

export interface ImportPlan {
  /** Holidays in API order with a selected date. */
  selected: NagerHoliday[];
  /** Selected dates with no existing company record — will be created. */
  toCreate: NagerHoliday[];
  /** Selected dates that already exist in the company — kept untouched. */
  existing: NagerHoliday[];
  /** Selected dates that are not present in the fetched set — cannot be imported. */
  skipped: string[];
}

/**
 * Splits a selection against the company's existing holiday dates. This is the
 * single place that decides create-vs-keep-vs-skip, so re-imports are
 * idempotent and never overwrite an existing (possibly hand-edited) holiday.
 */
export function buildImportPlan(
  holidays: readonly NagerHoliday[],
  selectedDates: readonly string[],
  existingDates: ReadonlySet<string>,
): ImportPlan {
  const byDate = new Map<string, NagerHoliday>();
  for (const h of holidays) byDate.set(h.date, h);
  const selected: NagerHoliday[] = [];
  const toCreate: NagerHoliday[] = [];
  const existing: NagerHoliday[] = [];
  const skipped: string[] = [];
  for (const date of selectedDates) {
    const h = byDate.get(date);
    if (!h) {
      skipped.push(date);
      continue;
    }
    selected.push(h);
    if (existingDates.has(date)) existing.push(h);
    else toCreate.push(h);
  }
  return { selected, toCreate, existing, skipped };
}
