"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { Button, DateRangePicker, toISODate, fromISODate, cn } from "@timeoff/ui";
import { addDaysISO, diffInDays, todayISO } from "@timeoff/domain";
import type {
  CalendarAuthorisation,
  CalendarLeave,
  CalendarRosterMember,
  RequestStatus,
} from "@/lib/calendar-shared";
import { MonthView } from "@/components/calendar/month-view";
import { ListView } from "@/components/calendar/list-view";
import { TeamView } from "@/components/calendar/team-view";
import { ExportButton } from "@/components/export-button";

type ViewMode = "month" | "list" | "team";

interface CalendarExplorerProps {
  canExport: boolean;
  /** Whether the department filter is offered (company-wide roles only). */
  showDepartmentFilter: boolean;
  departments: { id: string; name: string }[];
  leaveTypes: { id: string; name: string; color: string }[];
  /** Company has the authorisations module enabled (hides the layer toggle). */
  authorisationsEnabled: boolean;
}

interface CalendarData {
  requests: CalendarLeave[];
  roster: CalendarRosterMember[];
  holidays: string[];
  authorisations: CalendarAuthorisation[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthRangeOf(iso: string): { from: string; to: string } {
  const d = fromISODate(iso);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`,
  };
}

function quarterRangeOf(iso: string): { from: string; to: string } {
  const d = fromISODate(iso);
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3);
  const startMonth = q * 3 + 1;
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(startMonth + 2)}-${pad(new Date(year, startMonth + 2, 0).getDate())}`,
  };
}

function isFullMonth(range: { from: string; to: string }): boolean {
  const d = fromISODate(range.from);
  return (
    range.from === toISODate(new Date(d.getFullYear(), d.getMonth(), 1)) &&
    range.to === toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  );
}

function isFullQuarter(range: { from: string; to: string }): boolean {
  const d = fromISODate(range.from);
  const q = Math.floor(d.getMonth() / 3);
  const startMonth = q * 3 + 1;
  return (
    range.from === `${d.getFullYear()}-${pad(startMonth)}-01` &&
    range.to === `${d.getFullYear()}-${pad(startMonth + 2)}-${pad(new Date(d.getFullYear(), startMonth + 2, 0).getDate())}`
  );
}

function shiftRange(range: { from: string; to: string }, dir: -1 | 1) {
  if (isFullMonth(range)) {
    const d = fromISODate(range.from);
    const next = new Date(d.getFullYear(), d.getMonth() + dir, 1);
    return {
      from: toISODate(next),
      to: toISODate(new Date(next.getFullYear(), next.getMonth() + 1, 0)),
    };
  }
  if (isFullQuarter(range)) {
    const d = fromISODate(range.from);
    const q = Math.floor(d.getMonth() / 3) + dir;
    const year = d.getFullYear() + Math.floor(q / 4);
    const month = ((q % 4) + 4) % 4 * 3 + 1;
    return {
      from: `${year}-${pad(month)}-01`,
      to: `${year}-${pad(month + 2)}-${pad(new Date(year, month + 2, 0).getDate())}`,
    };
  }
  const span = diffInDays(range.from, range.to);
  return {
    from: addDaysISO(range.from, dir * span),
    to: addDaysISO(range.to, dir * span),
  };
}

export function CalendarExplorer({
  canExport,
  showDepartmentFilter,
  departments,
  leaveTypes,
  authorisationsEnabled,
}: CalendarExplorerProps) {
  const locale = useLocale();
  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");

  const [view, setView] = React.useState<ViewMode>("month");
  const [range, setRange] = React.useState(() => monthRangeOf(todayISO()));
  const [statusFilter, setStatusFilter] = React.useState<"all" | "approved" | "pending">("all");
  const [search, setSearch] = React.useState("");
  const [leaveTypeId, setLeaveTypeId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [showAuthorisations, setShowAuthorisations] = React.useState(false);
  const [data, setData] = React.useState<CalendarData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);
  const [pendingRange, setPendingRange] = React.useState<{ from: string | null; to: string | null } | null>(null);

  const from = range.from;
  const to = range.to;
  const statuses: RequestStatus[] =
    statusFilter === "approved"
      ? ["APPROVED"]
      : statusFilter === "pending"
        ? ["PENDING"]
        : ["APPROVED", "PENDING"];
  const statusKey = statuses.join(",");

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to, statuses: statusKey });
    if (leaveTypeId) params.set("leaveType", leaveTypeId);
    if (departmentId) params.set("department", departmentId);
    if (view === "team") params.set("roster", "1");
    if (showAuthorisations) params.set("authorisations", "1");
    fetch(`/api/calendar?${params.toString()}`)
      .then((res) =>
        res.ok
          ? res.json()
          : res.json().then((json) => {
              throw new Error(json?.error ?? "calendar.loadFailed");
            }),
      )
      .then((json: CalendarData) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, statusKey, leaveTypeId, departmentId, view, reloadTick, showAuthorisations]);

  const today = todayISO();
  const isCurrentMonth = isFullMonth(range) && range.from === monthRangeOf(today).from;
  const isCurrentQuarter = isFullQuarter(range) && range.from === quarterRangeOf(today).from;
  const isCustom = !isFullMonth(range) && !isFullQuarter(range);

  const rangeLabel = React.useMemo(() => {
    if (isFullMonth(range)) {
      const d = fromISODate(range.from);
      return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    }
    if (isFullQuarter(range)) {
      const d = fromISODate(range.from);
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      return t("quarterLabel", { quarter, year: d.getFullYear() });
    }
    return `${range.from} → ${range.to}`;
  }, [range, locale, t]);

  const filters = {
    from,
    to,
    departmentId: departmentId || undefined,
    leaveTypeId: leaveTypeId || undefined,
    statuses,
  };

  const allRequests = data?.requests ?? [];
  const allRoster = data?.roster ?? [];
  const holidays = data?.holidays ?? [];
  const allAuthorisations = data?.authorisations ?? [];

  const query = search.trim().toLocaleLowerCase();
  const requests = query
    ? allRequests.filter((r: CalendarLeave) => r.userName.toLocaleLowerCase().includes(query))
    : allRequests;
  const roster = query
    ? allRoster.filter((m: CalendarRosterMember) => m.name.toLocaleLowerCase().includes(query))
    : allRoster;
  const authorisations = query
    ? allAuthorisations.filter((a: CalendarAuthorisation) => a.userName.toLocaleLowerCase().includes(query))
    : allAuthorisations;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 items-center gap-0.5 rounded-md bg-muted p-1 text-muted-foreground">
          {(
            [
              { value: "month", label: t("viewMonth") },
              { value: "list", label: t("viewList") },
              { value: "team", label: t("viewTeam") },
            ] as { value: ViewMode; label: string }[]
          ).map((v: { value: ViewMode; label: string }) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              className={cn(
                "inline-flex h-7 items-center rounded-sm px-3 text-sm font-medium transition-colors",
                view === v.value && "bg-card text-foreground shadow-sm"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="inline-flex h-9 items-center gap-0.5 rounded-md bg-muted p-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setRange(monthRangeOf(todayISO()))}
            className={cn(
              "inline-flex h-7 items-center rounded-sm px-3 text-sm font-medium transition-colors",
              isCurrentMonth && "bg-card text-foreground shadow-sm"
            )}
          >
            {t("rangeMonth")}
          </button>
          <button
            type="button"
            onClick={() => setRange(quarterRangeOf(todayISO()))}
            className={cn(
              "inline-flex h-7 items-center rounded-sm px-3 text-sm font-medium transition-colors",
              isCurrentQuarter && "bg-card text-foreground shadow-sm"
            )}
          >
            {t("rangeQuarter")}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={tCommon("prevRange")}
            onClick={() => setRange((r) => shiftRange(r, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRange(monthRangeOf(todayISO()))}
          >
            {t("today")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={tCommon("nextRange")}
            onClick={() => setRange((r) => shiftRange(r, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <DateRangePicker
            value={
              isCustom
                ? { from, to }
                : pendingRange
                  ? { from: pendingRange.from, to: pendingRange.to }
                  : { from: null, to: null }
            }
            onChange={(r) => {
              setPendingRange(r);
              if (r.from && r.to) {
                setRange({ from: r.from, to: r.to });
                setPendingRange(null);
              }
            }}
            placeholder={t("customRange")}
            className="h-9"
          />
          {isCustom ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("clearRange")}
              onClick={() => setRange(monthRangeOf(todayISO()))}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>

        <span className="text-sm font-medium tabular-nums text-foreground">{rangeLabel}</span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("refresh")}
            onClick={() => setReloadTick((n) => n + 1)}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          {canExport ? (
            <ExportButton variant="filters" filters={filters} disabled={loading} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("leaveTypeFilter")}
        >
          <option value="">{t("allLeaveTypes")}</option>
          {leaveTypes.map((lt: { id: string; name: string; color: string }) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </select>
        {showDepartmentFilter ? (
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("departmentFilter")}
          >
            <option value="">{t("allDepartments")}</option>
            {departments.map((d: { id: string; name: string }) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "approved" | "pending")}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("statusFilter")}
        >
          <option value="all">{t("statusAll")}</option>
          <option value="approved">{t("statusApproved")}</option>
          <option value="pending">{t("statusPending")}</option>
        </select>
        {authorisationsEnabled ? (
          <label
            className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-sm"
          >
            <input
              type="checkbox"
              checked={showAuthorisations}
              onChange={(e) => setShowAuthorisations(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
              aria-label={t("showAuthorisations")}
            />
            <span className="text-muted-foreground">{t("showAuthorisations")}</span>
          </label>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchEmployees")}
            aria-label={t("searchEmployees")}
            className="h-9 w-52 rounded-md border border-input bg-card pl-8 pr-8 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {search ? (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {!loading && data ? (
          <span className="text-xs text-muted-foreground">
            {t("showingCount", { count: requests.length })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive-border bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground">
          {t("loadFailed")}
        </div>
      ) : loading && !data ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      ) : data ? (
        <div>
          {view === "month" ? (
            <MonthView
              requests={requests}
              holidays={holidays}
              authorisations={authorisations}
              year={fromISODate(from).getFullYear()}
              month={fromISODate(from).getMonth() + 1}
            />
          ) : view === "list" ? (
            <ListView requests={requests} holidays={holidays} authorisations={authorisations} from={from} to={to} />
          ) : (
            <TeamView
              requests={requests}
              roster={roster}
              holidays={holidays}
              authorisations={authorisations}
              from={from}
              to={to}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
