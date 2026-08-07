import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { canExport, listCalendarRoster } from "@/lib/services/calendar";
import { getUserScope, getVisibleUserIds } from "@/lib/permissions";
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
            leaveTypes={leaveTypes.map((lt) => ({
              id: lt.id,
              name: lt.name,
              color: lt.color,
            }))}
          />
        </div>

        <aside className="space-y-4">
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
                {upcoming.map((request) => (
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
