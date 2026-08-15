import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Sun,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { prisma } from "@timeoff/db";
import { todayISO } from "@timeoff/domain";
import { requireRole } from "@/lib/session";
import { canManageUsers, getUserScope } from "@/lib/permissions";
import { workforceStats } from "@/lib/services/workforce";
import { ExportButton } from "@/components/export-button";
import { WorkforceFilters } from "@/components/workforce/workforce-filters";
import { Badge, EmptyState } from "@timeoff/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("workforce") };
}

export const dynamic = "force-dynamic";

function statCard(icon: React.ReactNode, label: string, value: string | number, hint?: string) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function formatDate(iso: string, locale: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

function formatRange(start: string, end: string, locale: string): string {
  if (start === end) return formatDate(start, locale);
  return `${formatDate(start, locale)} – ${formatDate(end, locale)}`;
}

function monthLabel(key: string, locale: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "short" });
}

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; department?: string }>;
}) {
  const user = await requireRole(["EXECUTIVE", "HR", "ADMIN", "MANAGER"]);
  const params = await searchParams;
  const t = await getTranslations("workforce");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const today = todayISO();
  const canManage = canManageUsers(user);

  const scope = getUserScope(user);
  const showDepartmentFilter = scope.kind === "all";

  // Validate query params against real data before computing anything.
  const [departmentIds, yearStarts] = await Promise.all([
    prisma.department.findMany({
      where: { companyId: user.companyId },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leaveBalance.findMany({
      where: { companyId: user.companyId },
      select: { periodStart: true },
      distinct: ["periodStart"],
    }),
  ]);
  const requestedDepartment =
    showDepartmentFilter &&
    params.department &&
    departmentIds.some((d) => d.id === params.department)
      ? params.department
      : undefined;
  const requestedYear =
    params.year && yearStarts.some((p) => p.periodStart === params.year) ? params.year : undefined;

  const stats = await workforceStats(user, {
    leaveYearStart: requestedYear,
    departmentId: requestedDepartment,
  });

  const todayKey = today.slice(0, 7);
  const maxMonthDays = Math.max(1, ...stats.monthlyUtilization.map((m) => m.days));
  const attentionCount =
    stats.attention.pending.length +
    stats.attention.lowBalances.length +
    stats.attention.conflicts.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { today })}
          </p>
        </div>
        <ExportButton variant="all" />
      </div>

      <WorkforceFilters
        leaveYears={stats.leaveYears}
        departments={stats.departmentsForFilter}
        selectedYearStart={stats.selectedYearStart}
        selectedDepartmentId={requestedDepartment}
        showDepartmentFilter={stats.showDepartmentFilter}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCard(<Users className="size-4" />, t("activeEmployees"), stats.activeEmployees, t("acrossAllDepartments"))}
        {statCard(<UserCheck className="size-4" />, t("offToday"), stats.offToday, t("approvedLeaveRightNow"))}
        {statCard(
          <CalendarClock className="size-4" />,
          t("pendingApprovals"),
          stats.pendingCount,
          t("requestsAwaitingDecision"),
        )}
        {statCard(
          <CalendarDays className="size-4" />,
          t("approvedDaysThisYear"),
          stats.approvedDays.toLocaleString(locale),
          t("approvedDaysHint", { year: stats.selectedYearStart.slice(0, 4) }),
        )}
        {statCard(<Wallet className="size-4" />, t("availableToday"), stats.availableToday, t("availableTodayHint"))}
        {statCard(
          <AlertTriangle className="size-4" />,
          t("lowBalance"),
          stats.lowBalanceCount,
          t("lowBalanceHint", { threshold: stats.lowBalanceThreshold }),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("whosOffToday")}
          </h2>
          {stats.offTodayList.length === 0 ? (
            <EmptyState
              className="mt-3"
              icon={<Sun className="size-6" />}
              title={t("offTodayEmptyTitle")}
              description={t("offTodayEmptyDescription")}
            />
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {stats.offTodayList.map((row) => (
                <li
                  key={row.requestId}
                  className="flex items-center justify-between gap-4 py-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: row.leaveTypeColor }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/requests/${row.requestId}`}
                        className="truncate font-medium text-foreground hover:underline"
                      >
                        {row.userName}
                      </Link>
                      {row.departmentName ? (
                        <Badge variant="neutral" className="ml-2 hidden font-normal sm:inline-flex">
                          {row.departmentName}
                        </Badge>
                      ) : null}
                      <p className="truncate text-xs text-muted-foreground">{row.leaveTypeName}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRange(row.startDate, row.endDate, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("attentionRequired")}
          </h2>
          {attentionCount === 0 ? (
            <EmptyState
              className="mt-3"
              icon={<ClipboardCheck className="size-6" />}
              title={t("attentionNothingTitle")}
              description={t("attentionNothingDescription")}
            />
          ) : (
            <div className="mt-3 space-y-4">
              {stats.attention.pending.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("attentionPending", { count: stats.attention.pending.length })}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {stats.attention.pending.slice(0, 5).map((row) => (
                      <li key={row.requestId} className="text-sm">
                        <Link
                          href={`/requests/${row.requestId}`}
                          className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground group-hover:text-primary">
                              {row.userName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {row.leaveTypeName} · {formatRange(row.startDate, row.endDate, locale)}
                            </span>
                          </span>
                          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {stats.attention.pending.length > 5 ? (
                    <Link
                      href="/approvals"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      {t("viewAllApprovals")}
                      <ArrowRight className="size-3" />
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {stats.attention.lowBalances.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("attentionLowBalances")}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {stats.attention.lowBalances.slice(0, 5).map((row) => (
                      <li key={row.userId} className="text-sm">
                        {canManage ? (
                          <Link
                            href={`/admin/balances?user=${row.userId}`}
                            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {row.userName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {row.departmentName ?? "—"}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {tCommon("dayCount", { count: row.available })}
                            </span>
                          </Link>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {row.userName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {row.departmentName ?? "—"}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {tCommon("dayCount", { count: row.available })}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {stats.attention.conflicts.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("attentionConflicts")}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {stats.attention.conflicts.slice(0, 5).map((row) => (
                      <li key={`${row.departmentName}-${row.date}`} className="text-sm">
                        <Link
                          href="/calendar"
                          className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground group-hover:text-primary">
                              {t("conflictItem", {
                                count: row.count,
                                department: row.departmentName,
                                date: formatDate(row.date, locale),
                              })}
                            </span>
                          </span>
                          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("departmentOverview")}
          </h2>
          {stats.departments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("noDepartments")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {stats.departments.map((department) => {
                const available = department.total - department.onLeave;
                const pct = department.total ? Math.round((available / department.total) * 100) : 100;
                return (
                  <li key={department.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium text-foreground">{department.name}</span>
                      <span className="text-muted-foreground">
                        {t("deptTotal", { count: department.total })} ·{" "}
                        <span className={department.onLeave > 0 ? "text-foreground" : undefined}>
                          {t("deptOnLeave", { count: department.onLeave })}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("deptAvailable", { count: available })}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                        title={t("deptAvailable", { count: available })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("monthlyUtilization", { year: stats.selectedYearStart.slice(0, 4) })}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("monthlyTotal", { count: stats.approvedDays })}
            </p>
          </div>
          {stats.approvedDays === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("nothingApprovedYet")}</p>
          ) : (
            <div className="mt-4 flex items-end gap-1.5">
              {stats.monthlyUtilization.map((month) => {
                const barHeight =
                  month.days === 0 ? 4 : Math.round(8 + (month.days / maxMonthDays) * 88);
                const isCurrent = month.key === todayKey;
                return (
                  <div
                    key={month.key}
                    className="flex flex-1 flex-col items-center gap-1.5"
                    title={tCommon("dayCount", { count: month.days })}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {month.days > 0 ? month.days : "·"}
                    </span>
                    <div
                      className={`w-full rounded-sm ${isCurrent ? "bg-primary" : "bg-primary/30"}`}
                      style={{ height: `${barHeight}px` }}
                      aria-hidden
                    />
                    <span
                      className={`text-[10px] ${isCurrent ? "font-medium text-foreground" : "text-muted-foreground"}`}
                    >
                      {monthLabel(month.key, locale)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("upcomingApprovedLeave")}
          </h2>
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t("viewCalendar")}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {stats.upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("noUpcomingApprovedLeave")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {stats.upcoming.map((row) => (
              <li
                key={row.requestId}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: row.leaveTypeColor }}
                    aria-hidden
                  />
                  <Link
                    href={`/requests/${row.requestId}`}
                    className="truncate font-medium text-foreground hover:underline"
                  >
                    {row.userName}
                  </Link>
                  {row.departmentName ? (
                    <Badge variant="neutral" className="hidden font-normal sm:inline-flex">
                      {row.departmentName}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span>{row.leaveTypeName}</span>
                  <span>{formatRange(row.startDate, row.endDate, locale)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
