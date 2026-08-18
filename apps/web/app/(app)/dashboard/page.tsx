import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ClipboardCheck, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { availableBalance, accruedVacationAsOf, fixedAnnualAccrual, addDaysISO, todayISO, leaveYearRange } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { balanceHistoryFor, listPendingForApproval, syncCurrentAccruals } from "@/lib/services/leave";
import { authorisationOverviewFor } from "@/lib/services/authorisations";
import { Badge, BalanceRing, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, statusVariant, type BadgeProps } from "@timeoff/ui";
import { BalanceHistory } from "@/components/balance-history";
import { resolveLeaveTypeName } from "@/lib/leave-type-name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("dashboard") };
}

const LEAVE_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  Vacation: "vacation",
  "Sick Leave": "sick",
};

const DEFAULT_COLORS: Record<string, string> = {
  Vacation: "#2e9486",
  "Sick Leave": "#e07b5a",
};

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  return statusVariant[status.toLowerCase()] ?? "neutral";
}

function formatSpan(start: string, end: string): string {
  return start === end ? start : `${start} – ${end}`;
}

export default async function DashboardPage() {
  const user = await requireAuth();
  const today = todayISO();
  const t = await getTranslations("dashboard");
  const tAuth = await getTranslations("authorisations");
  const tHistory = await getTranslations("balanceHistory");
  const tStatus = await getTranslations("status");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  const [balances, recent, upcoming, history, historyLimit] = await Promise.all([
    (async () => {
      // Same reconciliation the admin views use: current-year `accrued` keeps
      // growing month over month and `carriedOver` reflects the corrected
      // previous-year leftover, so the dashboard never shows a stale number.
      // Scoped to the signed-in user: only this page's balances are reconciled,
      // never a full-company recalculation on a personal read.
      await syncCurrentAccruals(prisma, user.companyId!, user.id);
      return prisma.leaveBalance.findMany({
        where: { userId: user.id, periodStart: { lte: today }, periodEnd: { gte: today } },
        include: { leaveType: true },
        orderBy: { periodStart: "desc" },
      });
    })(),
    prisma.leaveRequest.findMany({
      where: { userId: user.id },
      include: { leaveType: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.leaveRequest.findMany({
      where: { userId: user.id, endDate: { gte: today }, status: { in: ["APPROVED", "PENDING"] } },
      include: { leaveType: true },
      orderBy: { startDate: "asc" },
      take: 4,
    }),
    balanceHistoryFor(user, user.id, locale),
    (async () => {
      const vacation = await prisma.leaveType.findFirst({ where: { companyId: user.companyId, name: "Vacation" } });
      if (!vacation) return null;
      const policy = await prisma.leavePolicy.findFirst({
        where: { companyId: user.companyId, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
        select: { carryOverDays: true },
      });
      return policy?.carryOverDays ?? null;
    })(),
  ]);

  // Lazy-seed missing balances for active leave types that pre-date this user.
  const existingTypeIds = new Set(balances.map((b: (typeof balances)[number]) => b.leaveTypeId));
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const leaveTypes = await prisma.leaveType.findMany({
    where: { companyId: user.companyId, isArchived: false },
    orderBy: { sortOrder: "asc" },
  });
  const missingTypes = leaveTypes.filter((lt) => !existingTypeIds.has(lt.id));
  if (missingTypes.length > 0 && dbUser) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });
    const fiscal = company.fiscalYearStartMonth;
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const startYear = fiscal > 1 && month < fiscal ? year - 1 : year;
    const { start, end } = leaveYearRange(fiscal, startYear);
    const ratio = dbUser.employmentType === "PART_TIME" ? 0.5 : 1;

    const policies = await prisma.leavePolicy.findMany({
      where: { companyId: user.companyId!, annualAllotment: { gt: 0 } },
      select: {
        leaveTypeId: true,
        departmentId: true,
        countryCode: true,
        annualAllotment: true,
        leaveType: { select: { accrualMethod: true } },
      },
    });

    for (const lt of missingTypes) {
      const matches = policies.filter(
        (p) =>
          p.leaveTypeId === lt.id &&
          (p.departmentId === null || p.departmentId === dbUser.departmentId) &&
          (p.countryCode === null || p.countryCode === dbUser.countryCode),
      );
      const policy =
        matches.find((p) => p.departmentId === dbUser.departmentId) ??
        matches.find((p) => p.departmentId === null) ??
        null;
      if (!policy || policy.annualAllotment <= 0) continue;

      const asOf = today < end ? today : end;
      const method = policy.leaveType.accrualMethod ?? "CUMULATIVE_MONTHLY";
      let accrued: number;
      if (method === "FIXED_ANNUAL") {
        accrued = fixedAnnualAccrual({
          annualAllotment: policy.annualAllotment,
          employmentStartDate: dbUser.employmentStartDate,
          asOf,
          fullTimeRatio: ratio,
        });
      } else {
        const cumulative = accruedVacationAsOf({
          annualAllotment: policy.annualAllotment,
          employmentStartDate: dbUser.employmentStartDate,
          asOf,
          fullTimeRatio: ratio,
        });
        const prior = accruedVacationAsOf({
          annualAllotment: policy.annualAllotment,
          employmentStartDate: dbUser.employmentStartDate,
          asOf: addDaysISO(start, -1),
          fullTimeRatio: ratio,
        });
        accrued = Math.max(0, Math.round((cumulative - prior) * 100) / 100);
      }

      const row = await prisma.leaveBalance.create({
        data: {
          companyId: user.companyId!,
          userId: user.id,
          leaveTypeId: lt.id,
          periodStart: start,
          periodEnd: end,
          accrued,
          carriedOver: 0,
          adjustment: 0,
          used: 0,
          pending: 0,
        },
        include: { leaveType: true },
      });
      balances.push(row);
    }
  }

  const showApprovals = user.role !== "EMPLOYEE";
  const pendingForApproval = showApprovals ? (await listPendingForApproval(user)).slice(0, 5) : [];
  const authorisations = await authorisationOverviewFor(user);

  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {t("greeting", { name: firstName })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Button asChild>
          <Link href="/requests/new">
            <Plus className="size-4" />
            {t("requestLeave")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {balances.length > 0 ? (
          <div className={showApprovals ? "lg:col-span-1 space-y-6" : "lg:col-span-3 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"}>
            {balances.map((b: (typeof balances)[number]) => {
              const gross = b.accrued + b.carriedOver + b.adjustment;
              const usedFraction = gross > 0 ? (b.used + b.pending) / gross : 0;
              const ringColor = b.leaveType.color || DEFAULT_COLORS[b.leaveType.name] || undefined;
              return (
                <Card key={b.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarClock className="size-4 text-muted-foreground" />
                      {resolveLeaveTypeName(b.leaveType, locale)}
                    </CardTitle>
                    <CardDescription>
                      {t("leaveYear", { start: b.periodStart, end: b.periodEnd })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6">
                      <BalanceRing
                        value={usedFraction}
                        color={ringColor}
                        center={
                          <div className="text-center">
                            <p className="font-display text-2xl font-semibold leading-none">
                              {availableBalance(b)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{t("available")}</p>
                          </div>
                        }
                      />
                      <dl className="space-y-1.5 text-sm">
                        <div className="flex justify-between gap-6">
                          <dt className="text-muted-foreground">{t("accrued")}</dt>
                          <dd className="font-medium">{b.accrued}</dd>
                        </div>
                        <div className="flex justify-between gap-6">
                          <dt className="text-muted-foreground">{t("carriedOver")}</dt>
                          <dd className="font-medium">{b.carriedOver}</dd>
                        </div>
                        <div className="flex justify-between gap-6">
                          <dt className="text-muted-foreground">{t("used")}</dt>
                          <dd className="font-medium">{b.used}</dd>
                        </div>
                        <div className="flex justify-between gap-6">
                          <dt className="text-muted-foreground">{t("pending")}</dt>
                          <dd className="font-medium">{b.pending}</dd>
                        </div>
                      </dl>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className={showApprovals ? "lg:col-span-1" : "lg:col-span-3"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" />
                {t("vacationBalance")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t("noActiveBalance")}</p>
            </CardContent>
          </Card>
        )}

        {showApprovals ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-muted-foreground" />
                {t("approvalsWaiting")}
              </CardTitle>
              <CardDescription>{t("approvalsDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingForApproval.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("caughtUp")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {pendingForApproval.map((request: (typeof pendingForApproval)[number]) => (
                    <li key={request.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{request.user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatSpan(request.startDate, request.endDate)} · {tCommon("dayCount", { count: request.totalDays })}
                        </p>
                      </div>
                      <Badge tone={LEAVE_TONE[request.leaveType.name] ?? "custom"} className="shrink-0">
                        {resolveLeaveTypeName(request.leaveType, locale)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("upcomingLeave")}</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingBooked")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((request: (typeof upcoming)[number]) => (
                  <li key={request.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatSpan(request.startDate, request.endDate)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {resolveLeaveTypeName(request.leaveType, locale)} · {tCommon("dayCount", { count: request.totalDays })}
                      </p>
                    </div>
                    <Badge variant={statusBadgeVariant(request.status)}>{tStatus(request.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("recentRequests")}</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noRequestsYet")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((request: (typeof recent)[number]) => (
                  <li key={request.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatSpan(request.startDate, request.endDate)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {resolveLeaveTypeName(request.leaveType, locale)} · {tCommon("dayCount", { count: request.totalDays })}
                      </p>
                    </div>
                    <Badge variant={statusBadgeVariant(request.status)}>{tStatus(request.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {authorisations ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              {t("authorisationsBalance")}
            </CardTitle>
            <CardDescription>{t("authorisationsPeriod", { period: authorisations.period })}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-md border border-border p-4">
                <p className="text-xs text-muted-foreground">{tAuth("available")}</p>
                <p className="mt-1 font-display text-2xl font-semibold">
                  {tAuth("hours", { count: authorisations.available })}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-xs text-muted-foreground">{tAuth("used")}</p>
                <p className="mt-1 font-display text-2xl font-semibold">
                  {tAuth("hours", { count: authorisations.used })}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-xs text-muted-foreground">{tAuth("pending")}</p>
                <p className="mt-1 font-display text-2xl font-semibold">
                  {tAuth("hours", { count: authorisations.pending })}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-xs text-muted-foreground">{tAuth("upcomingTitle")}</p>
                <p className="mt-1 font-display text-2xl font-semibold">
                  {tAuth("items", { count: authorisations.upcoming.length })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            {tHistory("title")}
          </CardTitle>
          <CardDescription>{tHistory("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <BalanceHistory years={history} carryOverLimit={historyLimit} />
        </CardContent>
      </Card>
    </div>
  );
}
