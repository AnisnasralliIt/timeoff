"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@timeoff/ui";
import { eachDay } from "@timeoff/domain";
import {
  clipLeaveToDays,
  leaveSegments,
  type CalendarLeave,
  type CalendarRosterMember,
} from "@/lib/calendar-shared";
import { LeaveBar } from "@/components/calendar/leave-bar";

interface TeamViewProps {
  requests: CalendarLeave[];
  roster: CalendarRosterMember[];
  holidays: string[];
  from: string;
  to: string;
}

const DAY_WIDTH = 28;
const ROW_HEIGHT = 30;

function isWeekendDay(iso: string): boolean {
  const day = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay();
  return day === 0 || day === 6;
}

interface MonthSpan {
  label: string;
  start: number;
  count: number;
}

/** Month label spans over the day columns for the timeline header. */
function monthSpans(days: string[], locale: string): MonthSpan[] {
  const spans: MonthSpan[] = [];
  for (let i = 0; i < days.length; i++) {
    const month = days[i]!.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.label.startsWith(month)) {
      last.count++;
    } else {
      const label = new Date(
        Number(days[i]!.slice(0, 4)),
        Number(days[i]!.slice(5, 7)) - 1,
        1,
      ).toLocaleDateString(locale, { month: "short" });
      spans.push({ label, start: i, count: 1 });
    }
  }
  return spans;
}

export function TeamView({ requests, roster, holidays, from, to }: TeamViewProps) {
  const locale = useLocale();
  const t = useTranslations("calendar");
  const days = eachDay(from, to);
  const spans = monthSpans(days, locale);
  const total = days.length;
  const width = total * DAY_WIDTH;

  const barsByUser = new Map<string, CalendarLeave[]>();
  for (const r of requests) {
    const list = barsByUser.get(r.userId) ?? [];
    list.push(r);
    barsByUser.set(r.userId, list);
  }

  const rows = roster.map((member: CalendarRosterMember) => ({
    member,
    bars: (barsByUser.get(member.id) ?? [])
      .map((leave: CalendarLeave) => ({ leave, clip: clipLeaveToDays(leave, days) }))
      .filter((b): b is { leave: CalendarLeave; clip: { start: number; end: number } } => b.clip !== null)
      .map((b: { leave: CalendarLeave; clip: { start: number; end: number } }) => ({ ...b, segs: leaveSegments(b.leave, days) })),
  }));

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <div className="min-w-full" style={{ width: 176 + width }}>
          {/* Timeline header: month spans + day columns */}
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-20 flex w-44 shrink-0 items-center border-r border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              {t("teamHeaderEmployee")}
            </div>
            <div className="relative h-7 shrink-0" style={{ width }}>
              {spans.map((s: MonthSpan) => (
                <div
                  key={`${s.label}-${s.start}`}
                  className="absolute inset-y-0 border-r border-border px-1.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  style={{ left: s.start * DAY_WIDTH, width: s.count * DAY_WIDTH }}
                >
                  <span className="truncate">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Day-of-month header row */}
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-20 w-44 shrink-0 border-r border-border bg-card" />
            <div className="flex h-6 shrink-0" style={{ width }}>
              {days.map((d: string) => (
                <div
                  key={d}
                  className={cn(
                    "flex items-center justify-center border-r border-border/60 text-[10px] tabular-nums text-muted-foreground last:border-r-0",
                    isWeekendDay(d) || holidays.includes(d) ? "bg-muted/30" : "",
                    d.slice(-2) === "01" && "font-medium text-foreground"
                  )}
                  style={{ width: DAY_WIDTH }}
                >
                  {Number(d.slice(-2))}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {rows.map(({ member, bars }: (typeof rows)[number]) => (
            <div key={member.id} className="flex border-b border-border last:border-b-0">
              <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center gap-1.5 border-r border-border bg-card px-3 py-1">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {member.name}
                </span>
              </div>
              <div className="relative shrink-0" style={{ width, height: ROW_HEIGHT }}>
                <div className="absolute inset-0 flex">
                  {days.map((d: string) => (
                    <div
                      key={d}
                      className={cn(
                        "h-full border-r border-border/60 last:border-r-0",
                        (isWeekendDay(d) || holidays.includes(d)) && "bg-muted/30"
                      )}
                      style={{ width: DAY_WIDTH }}
                    />
                  ))}
                </div>
                {bars.map((b: (typeof bars)[number]) => (
                  <LeaveBar
                    key={b.leave.id}
                    leave={b.leave}
                    segs={b.segs}
                    unit="px"
                    dayWidth={DAY_WIDTH}
                    top={6}
                    height={18}
                    showLabel
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-teal-600" />
          {t("legendApproved")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-sm bg-teal-600/40" />
          {t("legendPending")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-border bg-muted" />
          {t("legendHoliday")}
        </span>
      </div>
    </div>
  );
}
