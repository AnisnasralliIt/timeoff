/**
 * Server-side Nager.Date client (§26). The browser never talks to Nager.Date:
 * it only calls the server action, which invokes this module. No API key is
 * required. All validation/parsing lives in the pure `@timeoff/domain` Nager
 * module; this file is the thin HTTP+error layer.
 */
import { normalizeCountryCode, parseNagerResponse, validateNagerYear, NagerError, type NagerHoliday } from "@timeoff/domain";
import { LeaveError } from "@/lib/services/leave";

/** Fixed Nager.Date endpoint — never derived from client input. */
export const NAGER_BASE_URL = "https://date.nager.at/api/v4/Holidays";
/** Reasonable timeout so a slow/unreachable provider never hangs a request. */
export const NAGER_TIMEOUT_MS = 10_000;

export function mapNagerError(error: NagerError): LeaveError {
  switch (error.code) {
    case "nagerInvalidCountry":
      return new LeaveError("Invalid country code.", "nagerInvalidCountry");
    case "nagerInvalidYear":
      return new LeaveError("Invalid year.", "nagerInvalidYear");
    case "nagerInvalidData":
      return new LeaveError("Invalid holiday data received.", "nagerInvalidData");
    default:
      return new LeaveError("Unable to reach Nager.Date.", "nagerUnreachable");
  }
}

/**
 * Fetches and validates holidays for `GET /api/v4/Holidays/{country}/{year}`.
 * Throws `LeaveError` with a stable code for every failure mode so the UI can
 * localize without exposing raw internal errors.
 */
export async function fetchNagerHolidays(countryCode: string, year: number): Promise<NagerHoliday[]> {
  let normalized: string;
  let validatedYear: number;
  try {
    normalized = normalizeCountryCode(countryCode);
    validatedYear = validateNagerYear(year);
  } catch (error) {
    throw mapNagerError(error as NagerError);
  }

  const url = `${NAGER_BASE_URL}/${normalized}/${validatedYear}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(NAGER_TIMEOUT_MS),
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    // AbortError from the timeout, DNS failure, connection refused, TLS, ...
    throw new LeaveError("Unable to reach Nager.Date.", "nagerUnreachable");
  }

  if (response.status === 404) {
    // Valid request, but the provider has no data for this country/year.
    throw new LeaveError("No holidays were returned.", "nagerNoHolidays");
  }
  if (!response.ok) {
    throw new LeaveError("Unable to reach Nager.Date.", "nagerUnreachable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LeaveError("Invalid holiday data received.", "nagerInvalidData");
  }

  let holidays: NagerHoliday[];
  try {
    holidays = parseNagerResponse(payload);
  } catch (error) {
    throw mapNagerError(error as NagerError);
  }
  if (holidays.length === 0) {
    throw new LeaveError("No holidays were returned.", "nagerNoHolidays");
  }
  return holidays;
}
