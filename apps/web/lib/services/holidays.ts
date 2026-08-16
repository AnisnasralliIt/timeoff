/**
 * Holiday management service — extends the EXISTING Holiday model (the single
 * source of truth for the calendar and vacation calculations). All operations
 * are company-scoped and restricted to HR/ADMIN (`requireHr`), with an audit
 * event per manual create/update/delete and ONE summary event per Nager import.
 *
 * Duplicate prevention and idempotency rely on the `@@unique([companyId, date])`
 * constraint: importing the same country/year twice creates nothing the second
 * time and never overwrites an existing (possibly hand-edited) holiday.
 */
import { prisma, Prisma, type HolidaySource } from "@timeoff/db";
import { buildImportPlan, isValidISODate, normalizeCountryCode, type NagerHoliday } from "@timeoff/domain";
import type { SessionUser } from "@/lib/session";
import { audit, LeaveError } from "@/lib/services/leave";
import { requireHr } from "@/lib/services/admin";
import { fetchNagerHolidays } from "@/lib/services/nager";

export type { HolidaySource };

export interface HolidayListItem {
  id: string;
  companyId: string;
  countryCode: string;
  name: string;
  date: string;
  isRecurring: boolean;
  source: HolidaySource;
  holidayTypes: string[];
  global: boolean;
  createdAt: Date;
}

/** All company holidays, newest to oldest, for the admin management list. */
export async function listHolidaysForAdmin(
  user: SessionUser,
  opts: { year?: number } = {},
): Promise<HolidayListItem[]> {
  requireHr(user);
  const where: Prisma.HolidayWhereInput = { companyId: user.companyId! };
  if (opts.year) {
    where.OR = [{ date: { gte: `${opts.year}-01-01`, lte: `${opts.year}-12-31` } }, { isRecurring: true }];
  }
  return prisma.holiday.findMany({
    where,
    orderBy: [{ date: "desc" }, { name: "asc" }],
  });
}

export interface CreateHolidayInput {
  name: string;
  date: string;
  holidayTypes?: string[];
  countryCode?: string;
}

function assertHolidayFields(name: string, date: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new LeaveError("Holiday name is required.", "holidayNameRequired");
  if (!isValidISODate(date)) throw new LeaveError("Invalid holiday date.", "holidayInvalidDate");
  return trimmed;
}

async function assertNoDateClash(companyId: string, date: string, excludeId?: string): Promise<void> {
  const dup = await prisma.holiday.findFirst({
    where: { companyId, date, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new LeaveError("A holiday already exists on this date.", "holidayDateExists");
}

/** Manual holiday creation. Imported and manual holidays behave identically. */
export async function createHolidayForAdmin(
  user: SessionUser,
  input: CreateHolidayInput,
): Promise<HolidayListItem> {
  requireHr(user);
  const companyId = user.companyId!;
  const name = assertHolidayFields(input.name, input.date);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { countryCode: true } });
  const countryCode = normalizeCountryCode(input.countryCode ?? company.countryCode);
  const holidayTypes = [...new Set(input.holidayTypes ?? [])].filter((t) => typeof t === "string");

  await assertNoDateClash(companyId, input.date);

  const holiday = await prisma.holiday.create({
    data: {
      companyId,
      countryCode,
      name,
      date: input.date,
      source: "MANUAL",
      holidayTypes,
      global: false,
    },
  });

  await audit(prisma, {
    companyId,
    actorId: user.id,
    action: "holiday.create",
    entityType: "Holiday",
    entityId: holiday.id,
    entityName: name,
    after: { name, date: input.date, countryCode, source: "MANUAL", holidayTypes },
  });

  return holiday;
}

export interface UpdateHolidayInput {
  name: string;
  date: string;
  holidayTypes?: string[];
}

/** Edit any holiday — imported or manual — exactly the same. */
export async function updateHolidayForAdmin(
  user: SessionUser,
  holidayId: string,
  input: UpdateHolidayInput,
): Promise<HolidayListItem> {
  requireHr(user);
  const companyId = user.companyId!;
  const holiday = await prisma.holiday.findFirst({ where: { id: holidayId, companyId } });
  if (!holiday) throw new LeaveError("Holiday not found.", "holidayNotFound");

  const name = assertHolidayFields(input.name, input.date);
  if (input.date !== holiday.date) await assertNoDateClash(companyId, input.date, holidayId);
  const holidayTypes = input.holidayTypes === undefined ? holiday.holidayTypes : [...new Set(input.holidayTypes)];

  const updated = await prisma.holiday.update({
    where: { id: holidayId },
    data: { name, date: input.date, holidayTypes },
  });

  await audit(prisma, {
    companyId,
    actorId: user.id,
    action: "holiday.update",
    entityType: "Holiday",
    entityId: holiday.id,
    entityName: name,
    before: { name: holiday.name, date: holiday.date, holidayTypes: holiday.holidayTypes },
    after: { name, date: input.date, holidayTypes },
  });

  return updated;
}

/**
 * Permanently deletes a holiday. The platform has no holiday archive (unlike
 * leave types) — holidays are date rows, so removal is the existing norm:
 * after deletion the day stops counting for vacation calculations and leaves
 * the calendar. Deletion is audited.
 */
export async function deleteHolidayForAdmin(user: SessionUser, holidayId: string): Promise<void> {
  requireHr(user);
  const companyId = user.companyId!;
  const holiday = await prisma.holiday.findFirst({ where: { id: holidayId, companyId } });
  if (!holiday) throw new LeaveError("Holiday not found.", "holidayNotFound");

  await prisma.holiday.delete({ where: { id: holidayId } });

  await audit(prisma, {
    companyId,
    actorId: user.id,
    action: "holiday.delete",
    entityType: "Holiday",
    entityId: holiday.id,
    entityName: holiday.name,
    before: {
      name: holiday.name,
      date: holiday.date,
      countryCode: holiday.countryCode,
      source: holiday.source,
      holidayTypes: holiday.holidayTypes,
      global: holiday.global,
    },
  });
}

export interface NagerImportInput {
  countryCode: string;
  year: number;
  /** Dates the administrator explicitly selected in the preview. */
  selectedDates: string[];
}

export interface NagerImportResult {
  countryCode: string;
  year: number;
  fetched: number;
  selected: number;
  created: number;
  existing: number;
  skipped: number;
}

/**
 * Idempotent Nager.Date import (§15–18): the server re-fetches the official
 * data, matches the selection against it, and only creates missing holidays.
 * Existing holidays — including hand-edited ones — are never overwritten.
 * One summary audit event records the whole import.
 */
export async function importNagerHolidaysForAdmin(
  user: SessionUser,
  input: NagerImportInput,
): Promise<NagerImportResult> {
  requireHr(user);
  const companyId = user.companyId!;
  const countryCode = normalizeCountryCode(input.countryCode);
  const year = input.year;
  const selectedDates = [...new Set(input.selectedDates)];
  if (selectedDates.length === 0) {
    throw new LeaveError("Select at least one holiday to import.", "nagerNoSelection");
  }

  // Server-side refetch so the imported rows always mirror the real API
  // payload, never a client-supplied name/date.
  const fetched = await fetchNagerHolidays(countryCode, year);

  const existingRows = await prisma.holiday.findMany({
    where: { companyId, date: { in: selectedDates } },
    select: { date: true },
  });
  const existingDates = new Set(existingRows.map((r) => r.date));

  const plan = buildImportPlan(fetched, selectedDates, existingDates);

  let created = 0;
  if (plan.toCreate.length > 0) {
    // skipDuplicates is the database-level idempotency guard (e.g. a concurrent
    // import); the unique(companyId, date) index backs it.
    const res = await prisma.holiday.createMany({
      data: plan.toCreate.map((h: NagerHoliday) => ({
        companyId,
        countryCode,
        name: h.name,
        date: h.date,
        source: "NAGER_DATE" as const,
        holidayTypes: h.types,
        global: h.global ?? false,
      })),
      skipDuplicates: true,
    });
    created = res.count;
  }

  const existing = existingRows.length + (plan.toCreate.length - created);
  const result: NagerImportResult = {
    countryCode,
    year,
    fetched: fetched.length,
    selected: plan.selected.length,
    created,
    existing,
    skipped: plan.skipped.length,
  };

  await audit(prisma, {
    companyId,
    actorId: user.id,
    action: "holiday.import",
    entityType: "Holiday",
    entityId: companyId, // one summary event for the whole import
    entityName: `${countryCode} ${year}`,
    metadata: result,
  });

  return result;
}
