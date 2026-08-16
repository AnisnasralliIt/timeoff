"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import { requireHr } from "@/lib/services/admin";
import {
  createHolidayForAdmin,
  updateHolidayForAdmin,
  deleteHolidayForAdmin,
  importNagerHolidaysForAdmin,
  type NagerImportResult,
} from "@/lib/services/holidays";
import { fetchNagerHolidays } from "@/lib/services/nager";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";
import type { NagerHoliday } from "@timeoff/domain";

export interface ActionState extends ServerErrorShape {
  ok?: boolean;
}

export interface FetchNagerState extends ServerErrorShape {
  ok?: boolean;
  holidays?: NagerHoliday[];
}

export interface ImportState extends ServerErrorShape {
  ok?: boolean;
  result?: NagerImportResult;
}

const HOLIDAY_PATHS = ["/admin", "/admin/holidays"];

function revalidateHolidays() {
  for (const path of HOLIDAY_PATHS) revalidatePath(path);
}

function readTypes(value: FormDataEntryValue | null): string[] {
  const raw = String(value ?? "").trim();
  return raw ? [raw] : [];
}

export async function createHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await createHolidayForAdmin(user, {
      name: String(formData.get("name") ?? ""),
      date: String(formData.get("date") ?? ""),
      holidayTypes: readTypes(formData.get("holidayTypes")),
      countryCode: String(formData.get("countryCode") ?? "") || undefined,
    });
    revalidateHolidays();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function updateHolidayAction(
  holidayId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await updateHolidayForAdmin(user, holidayId, {
      name: String(formData.get("name") ?? ""),
      date: String(formData.get("date") ?? ""),
      holidayTypes: readTypes(formData.get("holidayTypes")),
    });
    revalidateHolidays();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function deleteHolidayAction(
  holidayId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await deleteHolidayForAdmin(user, holidayId);
    revalidateHolidays();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

/** Fetches holidays from Nager.Date — server-side only, never from the browser. */
export async function fetchNagerHolidaysAction(countryCode: string, year: number): Promise<FetchNagerState> {
  const user = await requireAuth();
  try {
    requireHr(user);
    const holidays = await fetchNagerHolidays(countryCode, year);
    return { ok: true, holidays };
  } catch (error) {
    return toErrorState(error);
  }
}

/** Imports the administrator's explicit preview selection (idempotent). */
export async function importNagerHolidaysAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireAuth();
  try {
    let selectedDates: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(formData.get("selectedDates") ?? "[]"));
      selectedDates = Array.isArray(parsed) ? parsed.filter((d) => typeof d === "string") : [];
    } catch {
      selectedDates = [];
    }
    const result = await importNagerHolidaysForAdmin(user, {
      countryCode: String(formData.get("countryCode") ?? ""),
      year: Number(formData.get("year") ?? 0),
      selectedDates,
    });
    revalidateHolidays();
    return { ok: true, result };
  } catch (error) {
    return toErrorState(error);
  }
}
