import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { TriangleAlert } from "lucide-react";
import { prisma } from "@timeoff/db";
import { addDaysISO, eachDay, todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { canExport, listCalendarRoster, listCalendarRequests } from "@/lib/services/calendar";
import { getAuthorisationPolicy } from "@/lib/services/authorisations";
import { getUserScope, getVisibleUserIds } from "@/lib/permissions";
import { staffingWarnings } from "@/lib/calendar-shared";
import { CalendarExplorer } from "@/components/calendar/explorer";
import { CalendarFeedCard } from "@/components/calendar-feed";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("calendar") };
}

export const dynamic = "force-dynamic";

function shortDate(iso: string, locale: string): string {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export default async function CalendarPage() {
  const user = await requireAuth();
  const locale = await getLocale();
  const t = await getTranslations("calendar");
  const today = todayISO();

  const scope = getUserScope(user);
  const showDepartmentFilter = scope.kind === "all";

  const [leaveTypes, allDepartments] = await Promise.all([
    prisma.leaveType.findMany({
      where: { companyId: user.companyId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.department.findMany({
      where: { companyId: user.companyId },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // The optional authorisations layer is only offered when the module is on;
  // when off the toggle is hidden and the calendar never queries the data.
  const authorisationPolicy = await getAuthorisationPolicy(prisma, user.companyId!);
  const authorisationsEnabled = authorisationPolicy?.enabled === true;

  const departments = showDepartmentFilter
    ? allDepartments.map((d: (typeof allDepartments)[number]) => ({ id: d.id, name: d.name }))
    : allDepartments.filter((d: (typeof allDepartments)[number]) => d.id === scope.departmentId).map((d: (typeof allDepartments)[number]) => ({ id: d.id, name: d.name }));

  // Upcoming-leave card: scoped exactly like every other calendar query.
  const visible = await getVisibleUserIds(user);
  const upcoming = await prisma.leaveRequest.findMany({
    where: {
      companyId: user.companyId,
      status: { in: ["APPROVED", "PENDING"] },
      endDate: { gte: today },
      ...(visible === "all" ? {} : { user: { id: { in: visible } } }),
    },
    include: { user: true, leaveType: true },
    orderBy: { startDate: "asc" },
    take: 6,
  });

  const roster = await listCalendarRoster(user);

  // Who's off today — scoped exactly like every other calendar query.
  const offToday = await listCalendarRequests(user, {
    from: today,
    to: today,
    statuses: ["APPROVED", "PENDING"],
  });
  const offTodayUnique = [...new Map(offToday.map((r) => [r.userId, r])).values()];

  // Department availability from the scoped roster + today's absences.
  const availability = departments
    .map((d) => {
      const total = roster.filter((m) => m.departmentId === d.id).length;
      const off = new Set(offToday.filter((r) => r.departmentId === d.id).map((r) => r.userId)).size;
      return { id: d.id, name: d.name, total, available: Math.max(0, total - off) };
    })
    .filter((d) => d.total > 0);

  // Staffing warnings for the next two weeks (confirmed absences only).
  const warningEnd = addDaysISO(today, 13);
  const windowAbsences = await prisma.leaveRequest.findMany({
    where: {
      companyId: user.companyId,
      status: "APPROVED",
      startDate: { lte: warningEnd },
      endDate: { gte: today },
      ...(visible === "all" ? {} : { user: { id: { in: visible } } }),
    },
    select: {
      userId: true,
      startDate: true,
      endDate: true,
      user: { select: { department: { select: { name: true } } } },
    },
  });
  const warnings = staffingWarnings(
    windowAbsences.map((a) => ({
      userId: a.userId,
      startDate: a.startDate,
      endDate: a.endDate,
      departmentName: a.user.department.name,
    })),
    eachDay(today, warningEnd),
  ).slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CalendarExplorer
            canExport={canExport(user)}
            showDepartmentFilter={showDepartmentFilter}
            departments={departments}
            authorisationsEnabled={authorisationsEnabled}
            leaveTypes={leaveTypes.map((lt: (typeof leaveTypes)[number]) => ({
              id: lt.id,
              name: lt.name,
              color: lt.color,
            }))}
          />
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("whosOffToday")}
            </h2>
            {offTodayUnique.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("whosOffNone")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {offTodayUnique.map((request: (typeof offTodayUnique)[number]) => (
                  <li
                    key={request.userId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{request.userName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {request.departmentName}
                      </p>
                    </div>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background:
                          request.status === "APPROVED"
                            ? request.leaveTypeColor
                            : "var(--color-muted-foreground)",
                      }}
                      aria-hidden
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("upcomingLeave")}
            </h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("nothingBookedYet")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {upcoming.map((request: (typeof upcoming)[number]) => (
                  <li
                    key={request.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{request.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {request.startDate === request.endDate
                          ? shortDate(request.startDate, locale)
                          : `${shortDate(request.startDate, locale)} – ${shortDate(request.endDate, locale)}`}
                      </p>
                    </div>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background:
                          request.status === "APPROVED"
                            ? request.leaveType.color
                            : "var(--color-muted-foreground)",
                      }}
                      aria-hidden
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("departmentAvailability")}
            </h2>
            {availability.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("availabilityEmpty")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {availability.map((d: (typeof availability)[number]) => (
                  <li key={d.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-foreground">{d.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("availabilityFraction", { available: d.available, total: d.total })}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${d.total ? (d.available / d.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("staffingWarnings")}
            </h2>
            {warnings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("staffingWarningsNone")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {warnings.map((warning: (typeof warnings)[number], index: number) => (
                  <li
                    key={`${warning.departmentName}-${warning.date}-${index}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                    <p className="text-foreground">
                      {t("staffingWarningLine", {
                        count: warning.count,
                        department: warning.departmentName,
                        date: shortDate(warning.date, locale),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            <h2 className="font-display text-base font-semibold text-foreground">
              {t("teamVisibility")}
            </h2>
            <p className="mt-1">
              {showDepartmentFilter
                ? t("visibilityCompanyWide", { count: roster.length })
                : t("visibilityDepartment")}
            </p>
          </div>

          <CalendarFeedCard />
        </aside>
      </div>
    </div>
  );
}
