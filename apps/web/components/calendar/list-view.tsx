"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Users } from "lucide-react";
import { Badge, EmptyState, statusVariant, cn } from "@timeoff/ui";
import { eachDay } from "@timeoff/domain";
import { isHalfDay, type CalendarLeave } from "@/lib/calendar-shared";

interface ListViewProps {
  requests: CalendarLeave[];
  holidays: string[];
  from: string;
  to: string;
}

function shortDate(iso: string, locale: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

function isWeekendDay(iso: string): boolean {
  const day = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay();
  return day === 0 || day === 6;
}

function HalfNote({ leave }: { leave: CalendarLeave }) {
  const t = useTranslations("dayPart");
  const notes = [
    isHalfDay(leave.startDayPart) ? t(leave.startDayPart) : null,
    isHalfDay(leave.endDayPart) ? t(leave.endDayPart) : null,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return <span className="text-muted-foreground">· {notes.join(" · ")}</span>;
}

export function ListView({ requests, holidays, from, to }: ListViewProps) {
  const locale = useLocale();
  const t = useTranslations("calendar");
  const tStatus = useTranslations("status");
  const [group, setGroup] = React.useState<"date" | "employee">("date");

  const rangeLabel = `${shortDate(from, locale)} – ${shortDate(to, locale)}`;

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <EmptyState
          icon={<CalendarDays className="size-6" />}
          title={t("quietRange")}
          description={t("quietRangeDescription", { range: rangeLabel })}
        />
      </div>
    );
  }

  if (group === "date") {
    const days = eachDay(from, to);
    const rows = days
      .map((day: (typeof days)[number]) => ({
        day,
        off: requests.filter((r: CalendarLeave) => day >= r.startDate && day <= r.endDate),
      }))
      .filter((r: { day: string; off: CalendarLeave[] }) => r.off.length > 0);
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <GroupToggle value={group} onChange={setGroup} t={t} />
        <ul className="mt-3 divide-y divide-border">
          {rows.map(({ day, off }: (typeof rows)[number]) => (
            <li key={day} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
              <span
                className={cn(
                  "w-36 shrink-0 font-medium text-foreground",
                  holidays.includes(day) ? "text-warning" : isWeekendDay(day) && "text-muted-foreground"
                )}
              >
                {shortDate(day, locale)}
                {holidays.includes(day) ? (
                  <span className="ml-1 rounded bg-warning/10 px-1 text-[10px] uppercase tracking-wide text-warning">
                    {t("holiday")}
                  </span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {off.map((r: CalendarLeave) => (
                  <Link
                    key={r.id}
                    href={`/requests/${r.id}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 transition-colors hover:bg-accent"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: r.leaveTypeColor }} aria-hidden />
                    <span className="truncate font-medium text-foreground">{r.userName}</span>
                    <span className="truncate text-muted-foreground">{r.leaveTypeName}</span>
                    <HalfNote leave={r} />
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const byUser = new Map<string, CalendarLeave[]>();
  for (const r of requests) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }
  const users = [...byUser.entries()].sort((a: [string, CalendarLeave[]], b: [string, CalendarLeave[]]) => a[1][0]!.userName.localeCompare(b[1][0]!.userName));
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <GroupToggle value={group} onChange={setGroup} t={t} />
      <ul className="mt-3 divide-y divide-border">
        {users.map(([userId, list]) => (
          <li key={userId} className="py-2.5">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="size-4 text-muted-foreground" />
              {list[0]!.userName}
              <span className="text-xs font-normal text-muted-foreground">{list[0]!.departmentName}</span>
            </p>
            <ul className="mt-1.5 space-y-1 pl-6">
              {list.map((r: CalendarLeave) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <Link
                    href={`/requests/${r.id}`}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                  >
                    <span className="size-2 rounded-full" style={{ background: r.leaveTypeColor }} aria-hidden />
                    {r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`}
                  </Link>
                  <span className="text-muted-foreground">{r.leaveTypeName}</span>
                  <HalfNote leave={r} />
                  <span className="text-muted-foreground">{t("workingDays", { count: r.totalDays })}</span>
                  <Badge variant={statusVariant[r.status.toLowerCase()] ?? "neutral"}>
                    {tStatus(r.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupToggle({
  value,
  onChange,
  t,
}: {
  value: "date" | "employee";
  onChange: (v: "date" | "employee") => void;
  t: (key: string) => string;
}) {
  const options: { value: "date" | "employee"; label: string }[] = [
    { value: "date", label: t("groupByDate") },
    { value: "employee", label: t("groupByEmployee") },
  ];
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
      {options.map((opt: { value: "date" | "employee"; label: string }) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-7 rounded-sm px-3 text-xs font-medium transition-colors",
            value === opt.value && "bg-card text-foreground shadow-sm"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
