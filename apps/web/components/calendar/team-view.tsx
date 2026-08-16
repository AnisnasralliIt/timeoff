"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@timeoff/ui";
import { eachDay, todayISO } from "@timeoff/domain";
import {
  clipLeaveToDays,
  leaveSegments,
  type CalendarAuthorisation,
  type CalendarLeave,
  type CalendarRosterMember,
} from "@/lib/calendar-shared";
import { LeaveBar } from "@/components/calendar/leave-bar";
import { CalendarLegend } from "@/components/calendar/calendar-legend";

interface TeamViewProps {
  requests: CalendarLeave[];
  roster: CalendarRosterMember[];
  holidays: string[];
  authorisations: CalendarAuthorisation[];
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

export function TeamView({ requests, roster, holidays, authorisations, from, to }: TeamViewProps) {
  const locale = useLocale();
  const t = useTranslations("calendar");
  const today = todayISO();
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
  const authByUser = new Map<string, CalendarAuthorisation[]>();
  for (const a of authorisations) {
    const list = authByUser.get(a.userId) ?? [];
    list.push(a);
    authByUser.set(a.userId, list);
  }

  const rows = roster.map((member: CalendarRosterMember) => ({
    member,
    bars: (barsByUser.get(member.id) ?? [])
      .map((leave: CalendarLeave) => ({ leave, clip: clipLeaveToDays(leave, days) }))
      .filter((b): b is { leave: CalendarLeave; clip: { start: number; end: number } } => b.clip !== null)
      .map((b: { leave: CalendarLeave; clip: { start: number; end: number } }) => ({ ...b, segs: leaveSegments(b.leave, days) })),
    auth: authByUser.get(member.id) ?? [],
  }));

  const groups: {
    departmentId: string;
    departmentName: string;
    rows: (typeof rows)[number][];
  }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.departmentId === row.member.departmentId) {
      last.rows.push(row);
    } else {
      groups.push({
        departmentId: row.member.departmentId,
        departmentName: row.member.departmentName,
        rows: [row],
      });
    }
  }

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
                  title={holidays.includes(d) ? t("holidayDay") : undefined}
                  className={cn(
                    "flex items-center justify-center border-r border-border/60 text-[10px] tabular-nums text-muted-foreground last:border-r-0",
                    d === today
                      ? "bg-primary/5 font-medium text-primary"
                      : holidays.includes(d)
                        ? "bg-warning/10 font-medium text-warning"
                        : isWeekendDay(d) && "bg-muted/30",
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
          {groups.map((group: (typeof groups)[number]) => (
            <React.Fragment key={group.departmentId}>
              <div className="flex items-center border-b border-border bg-muted/30">
                <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center border-r border-border bg-muted/40 px-3 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    {group.departmentName}
                  </span>
                </div>
                <div className="h-7 flex-1" />
              </div>
              {group.rows.map(({ member, bars, auth }: (typeof rows)[number]) => (
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
                          title={holidays.includes(d) ? t("holidayDay") : undefined}
                          className={cn(
                            "h-full border-r border-border/60 last:border-r-0",
                            d === today
                              ? "bg-primary/5"
                              : holidays.includes(d)
                                ? "bg-warning/10"
                                : isWeekendDay(d) && "bg-muted/30"
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
                    {auth.map((a: CalendarAuthorisation) => {
                      const dayIndex = days.indexOf(a.date);
                      if (dayIndex === -1) return null;
                      const range =
                        a.startTime && a.endTime ? `${a.startTime}–${a.endTime}` : t("hours", { count: a.hours });
                      return (
                        <span
                          key={a.id}
                          title={`${a.userName} · ${range}`}
                          aria-hidden
                          className="absolute top-0.5 size-1.5 rounded-sm border border-primary/60 bg-primary/20"
                          style={{ left: dayIndex * DAY_WIDTH + DAY_WIDTH - 6 }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <CalendarLegend requests={requests} authorisations={authorisations} />
      </div>
    </div>
  );
}
