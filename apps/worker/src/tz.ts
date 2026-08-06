/** Timezone-aware calendar date helpers for scheduled jobs. */

import { addDaysISO, toISO } from "@timeoff/domain";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Today's calendar date (`YYYY-MM-DD`) in the given IANA timezone. */
export function todayInTz(tz: string): string {
  return formatter(tz).format(new Date());
}

/** The Monday of the week containing `todayInTz(tz)`. */
export function mondayOfWeek(tz: string): string {
  const parts = formatter(tz).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const dayOfWeek = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")))).getUTCDay();
  return addDaysISO(iso, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
}
