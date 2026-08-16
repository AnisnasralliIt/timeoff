"use client";

import { useTranslations } from "next-intl";
import type { CalendarAuthorisation } from "@/lib/calendar-shared";

/**
 * Compact, hour-based marker for the calendar's optional authorisations layer.
 * Deliberately distinct from the day-based leave bars: dashed outline, tinted
 * background, clock-like "HH:MM–HH:MM" text instead of leave-type colors.
 */
export function AuthorisationChip({
  authorisation,
  compact = false,
}: {
  authorisation: CalendarAuthorisation;
  compact?: boolean;
}) {
  const t = useTranslations("calendar");

  if (authorisation.startTime && authorisation.endTime) {
    const range = `${authorisation.startTime}–${authorisation.endTime}`;
    return (
      <span
        title={t("authorisationTooltip", {
          name: authorisation.userName,
          start: authorisation.startTime,
          end: authorisation.endTime,
        })}
        className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/50 bg-primary/5 px-1 py-0.5 text-[10px] leading-none text-foreground"
      >
        <span className="truncate">
          {compact ? range : `${authorisation.userName} · ${range}`}
        </span>
      </span>
    );
  }

  return (
    <span
      title={`${authorisation.userName} · ${t("hours", { count: authorisation.hours })}`}
      className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/50 bg-primary/5 px-1 py-0.5 text-[10px] leading-none text-foreground"
    >
      <span className="truncate">
        {compact ? t("hours", { count: authorisation.hours }) : `${authorisation.userName} · ${t("hours", { count: authorisation.hours })}`}
      </span>
    </span>
  );
}
