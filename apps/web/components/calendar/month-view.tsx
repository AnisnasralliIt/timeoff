"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { monthGrid, cn } from "@timeoff/ui";
import { todayISO } from "@timeoff/domain";
import {
  clipLeaveToDays,
  leaveSegments,
  type CalendarAuthorisation,
  type CalendarLeave,
} from "@/lib/calendar-shared";
import { LeaveBar } from "@/components/calendar/leave-bar";
import { AuthorisationChip } from "@/components/calendar/authorisation-chip";
import { CalendarLegend } from "@/components/calendar/calendar-legend";

interface MonthViewProps {
  requests: CalendarLeave[];
  holidays: string[];
  authorisations: CalendarAuthorisation[];
  year: number;
  month: number;
}

interface PlacedBar {
  leave: CalendarLeave;
  clip: { start: number; end: number };
  segs: ReturnType<typeof leaveSegments>;
  lane: number;
}

const BAR_TOP = 20;
const BAR_HEIGHT = 18;
const LANE_GAP = 22;

function isWeekendDay(iso: string): boolean {
  const day = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay();
  return day === 0 || day === 6;
}

function weekdayLabels(locale: string): string[] {
  const days = [1, 2, 3, 4, 5, 6, 0].map((d: number) =>
    new Date(2024, 0, 1 + d).toLocaleDateString(locale, { weekday: "short" }),
  );
  return days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1));
}

/** Greedy lane assignment so overlapping bars stack instead of colliding. */
function layoutWeek(weekDays: string[], requests: CalendarLeave[]): PlacedBar[] {
  const clipped = requests
    .map((leave: CalendarLeave) => ({ leave, clip: clipLeaveToDays(leave, weekDays) }))
    .filter((b): b is { leave: CalendarLeave; clip: { start: number; end: number } } => b.clip !== null);
  clipped.sort(
    (a: (typeof clipped)[number], b: (typeof clipped)[number]) => a.clip.start - b.clip.start || a.clip.end - b.clip.end,
  );
  const laneEnds: number[] = [];
  const placed: PlacedBar[] = [];
  for (const b of clipped) {
    let lane = laneEnds.findIndex((end) => end < b.clip.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }
    laneEnds[lane] = b.clip.end;
    placed.push({ leave: b.leave, clip: b.clip, segs: leaveSegments(b.leave, weekDays), lane });
  }
  return placed;
}

export function MonthView({ requests, holidays, authorisations, year, month }: MonthViewProps) {
  const locale = useLocale();
  const t = useTranslations("calendar");
  const cells = monthGrid(year, month).cells;
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const today = todayISO();
  const hasLeaveInMonth = requests.some((r: CalendarLeave) => r.startDate <= monthEnd && r.endDate >= monthStart);

  const authorisationsByDay = new Map<string, CalendarAuthorisation[]>();
  for (const a of authorisations) {
    const list = authorisationsByDay.get(a.date) ?? [];
    list.push(a);
    authorisationsByDay.set(a.date, list);
  }
  const hasAuthorisationsInMonth = authorisations.length > 0;

  return (
    <div className="select-none rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="mb-1 flex justify-center">
        <p className="text-sm font-medium text-foreground">
          {new Date(year, month - 1, 1).toLocaleDateString(locale, {
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdayLabels(locale).map((w: string) => (
          <div
            key={w}
            className="py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      {weeks.map((week: (string | null)[], wi: number) => {
        const weekDays = week.filter((d): d is string => d !== null);
        const placed = layoutWeek(weekDays, requests);
        return (
          <div key={wi} className="relative grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((day: string | null, ci: number) => {
              const isToday = day === today;
              const isHoliday = day !== null && holidays.includes(day);
              const isWeekend = day !== null && isWeekendDay(day);
              return (
                <div
                  key={day ?? ci}
                  title={isHoliday ? t("holidayDay") : undefined}
                  className={cn(
                    "relative h-28 border-r border-border p-1 text-right last:border-r-0",
                    isToday
                      ? "bg-primary/5"
                      : isHoliday
                        ? "bg-warning/10"
                        : isWeekend && "bg-muted/30"
                  )}
                >
                  {isHoliday ? (
                    <span
                      aria-hidden
                      className="absolute left-1.5 top-1.5 size-1.5 rounded-full bg-warning"
                    />
                  ) : null}
                  {day ? (
                    <span
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                        isToday
                          ? "bg-primary font-medium text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {Number(day.slice(-2))}
                    </span>
                  ) : null}
                  {day && authorisationsByDay.has(day) ? (
                    <div className="absolute inset-x-1 bottom-1 flex max-h-16 flex-col flex-wrap items-start gap-0.5 overflow-hidden">
                      {authorisationsByDay.get(day)!.map((a: CalendarAuthorisation) => (
                        <AuthorisationChip key={a.id} authorisation={a} compact />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {placed.map((bar: PlacedBar) => (
              <LeaveBar
                key={`${bar.leave.id}-w${wi}`}
                leave={bar.leave}
                segs={bar.segs}
                unit="pct"
                colCount={7}
                top={BAR_TOP + bar.lane * LANE_GAP}
                height={BAR_HEIGHT}
              />
            ))}
          </div>
        );
      })}
      {!hasLeaveInMonth && !hasAuthorisationsInMonth ? (
        <p className="px-1 pt-3 text-sm text-muted-foreground">{t("quietMonthShort")}</p>
      ) : null}
      <div className="mt-3 flex justify-center border-t border-border pt-3">
        <CalendarLegend requests={requests} authorisations={authorisations} />
      </div>
    </div>
  );
}
