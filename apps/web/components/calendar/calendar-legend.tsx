"use client";

import { useTranslations } from "next-intl";
import type { CalendarAuthorisation, CalendarLeave } from "@/lib/calendar-shared";

interface CalendarLegendProps {
  requests: CalendarLeave[];
  authorisations?: CalendarAuthorisation[];
}

const PENDING_STRIPES = "repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.25) 4px 8px)";

/** Small legend matching the calendar bars: leave-type colors, status, today. */
export function CalendarLegend({ requests, authorisations = [] }: CalendarLegendProps) {
  const t = useTranslations("calendar");

  const leaveTypes = [];
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.leaveTypeId)) continue;
    seen.add(r.leaveTypeId);
    leaveTypes.push({ id: r.leaveTypeId, name: r.leaveTypeName, color: r.leaveTypeColor });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {leaveTypes.map((lt: { id: string; name: string; color: string }) => (
        <span key={lt.id} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: lt.color }} aria-hidden />
          {lt.name}
        </span>
      ))}
      {leaveTypes.length > 0 ? <span aria-hidden className="size-0.5 rounded-full bg-muted-foreground/50" /> : null}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary" aria-hidden />
        {t("legendApproved")}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm bg-primary/70"
          style={{ backgroundImage: PENDING_STRIPES }}
          aria-hidden
        />
        {t("legendPending")}
      </span>
      {authorisations.length > 0 ? (
        <>
          <span aria-hidden className="size-0.5 rounded-full bg-muted-foreground/50" />
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed border-primary/50 bg-primary/5" aria-hidden />
            {t("legendAuthorisations")}
          </span>
        </>
      ) : null}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border bg-muted" aria-hidden />
        {t("legendWeekend")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-full bg-warning" aria-hidden />
        {t("legendHoliday")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 shrink-0 rounded-full border-2 border-primary bg-primary/20" aria-hidden />
        {t("legendToday")}
      </span>
    </div>
  );
}
