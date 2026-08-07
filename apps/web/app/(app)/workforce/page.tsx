import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Users, UserCheck, CalendarClock, Hourglass } from "lucide-react";
import { prisma } from "@timeoff/db";
import { todayISO } from "@timeoff/domain";
import { requireRole } from "@/lib/session";
import { ExportButton } from "@/components/export-button";

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

export default async function WorkforcePage() {
  const user = await requireRole(["EXECUTIVE", "HR", "ADMIN"]);
  const today = todayISO();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const t = await getTranslations("workforce");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  const [employees, departments, todayOff, pending, yearRequests, approvedToday] =
    await Promise.all([
      prisma.user.count({ where: { companyId: user.companyId, status: "ACTIVE" } }),
      prisma.department.findMany({
        where: { companyId: user.companyId },
        include: {
          _count: { select: { users: { where: { status: "ACTIVE" } } } },
          users: { where: { status: "ACTIVE" } },
        },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.leaveRequest.count({
        where: {
          companyId: user.companyId,
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
        },
      }),
      prisma.leaveRequest.count({
        where: { companyId: user.companyId, status: "PENDING" },
      }),
      prisma.leaveRequest.findMany({
        where: {
          companyId: user.companyId,
          status: "APPROVED",
          endDate: { gte: yearStart },
          startDate: { lte: yearEnd },
        },
        include: { leaveType: true, user: true },
      }),
      prisma.leaveRequest.findMany({
        where: {
          companyId: user.companyId,
          status: "APPROVED",
          startDate: { gte: today },
        },
        include: { user: true, leaveType: true },
        orderBy: { startDate: "asc" },
        take: 8,
      }),
    ]);

  const yearDays = yearRequests.reduce((sum: number, r: (typeof yearRequests)[number]) => sum + r.totalDays, 0);
  const utilizationByType = new Map<string, { name: string; color: string; days: number }>();
  for (const r of yearRequests) {
    const entry = utilizationByType.get(r.leaveTypeId) ?? {
      name: r.leaveType.name,
      color: r.leaveType.color,
      days: 0,
    };
    entry.days += r.totalDays;
    utilizationByType.set(r.leaveTypeId, entry);
  }
  const utilizationValues = [...utilizationByType.values()];
  const utilization = utilizationValues.sort((a: (typeof utilizationValues)[number], b: (typeof utilizationValues)[number]) => b.days - a.days);

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCard(
          <Users className="size-4" />,
          t("activeEmployees"),
          employees,
          t("acrossAllDepartments"),
        )}
        {statCard(
          <UserCheck className="size-4" />,
          t("offToday"),
          todayOff,
          t("approvedLeaveRightNow"),
        )}
        {statCard(
          <CalendarClock className="size-4" />,
          t("pendingApprovals"),
          pending,
          t("requestsAwaitingDecision"),
        )}
        {statCard(
          <Hourglass className="size-4" />,
          t("approvedDaysThisYear"),
          yearDays.toLocaleString(locale),
          t("paidPlusUnpaid"),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("headcountByDepartment")}
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {departments.map((department: (typeof departments)[number]) => {
              const offNow = department.users.filter((member: (typeof department.users)[number]) =>
                approvedToday.some(
                  (r: (typeof approvedToday)[number]) => r.userId === member.id && r.startDate <= today && r.endDate >= today,
                ),
              ).length;
              return (
                <li
                  key={department.id}
                  className="flex items-center justify-between gap-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-foreground">{department.name}</span>
                  <span className="text-muted-foreground">
                    {t("active", { count: department._count.users })}
                    {offNow > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("offTodayDept", { count: offNow })}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("approvedLeaveByType", { year: today.slice(0, 4) })}
          </h2>
          {utilization.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("nothingApprovedYet")}</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {utilization.map((entry: (typeof utilization)[number]) => {
                const pct = yearDays ? Math.round((entry.days / yearDays) * 100) : 0;
                return (
                  <li key={entry.name} className="text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: entry.color }}
                          aria-hidden
                        />
                        {entry.name}
                      </span>
                      <span className="text-muted-foreground">
                        {tCommon("dayCount", { count: entry.days })} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: entry.color }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="font-display text-base font-semibold text-foreground">
          {t("upcomingApprovedLeave")}
        </h2>
        {approvedToday.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("noUpcomingApprovedLeave")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {approvedToday.map((request: (typeof approvedToday)[number]) => (
              <li key={request.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: request.leaveType.color }}
                    aria-hidden
                  />
                  <Link
                    href={`/requests/${request.id}`}
                    className="truncate font-medium text-foreground hover:underline"
                  >
                    {request.user.name}
                  </Link>
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {request.startDate === request.endDate
                    ? request.startDate
                    : `${request.startDate} – ${request.endDate}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
