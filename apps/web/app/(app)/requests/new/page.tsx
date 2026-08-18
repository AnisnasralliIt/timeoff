import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { availableBalance, accruedVacationAsOf, fixedAnnualAccrual, addDaysISO, todayISO, leaveYearRange } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { syncCurrentAccruals } from "@/lib/services/leave";
import { RequestForm } from "@/components/request-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("newRequest") };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeAccrued(opts: {
  annualAllotment: number;
  employmentStartDate: string;
  fullTimeRatio: number;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  accrualMethod?: string;
}): number {
  const asOf = opts.asOf < opts.periodEnd ? opts.asOf : opts.periodEnd;
  const method = opts.accrualMethod ?? "CUMULATIVE_MONTHLY";
  if (method === "FIXED_ANNUAL") {
    return fixedAnnualAccrual({
      annualAllotment: opts.annualAllotment,
      employmentStartDate: opts.employmentStartDate,
      asOf,
      fullTimeRatio: opts.fullTimeRatio,
    });
  }
  const cumulative = accruedVacationAsOf({
    annualAllotment: opts.annualAllotment,
    employmentStartDate: opts.employmentStartDate,
    asOf,
    fullTimeRatio: opts.fullTimeRatio,
  });
  const prior = accruedVacationAsOf({
    annualAllotment: opts.annualAllotment,
    employmentStartDate: opts.employmentStartDate,
    asOf: addDaysISO(opts.periodStart, -1),
    fullTimeRatio: opts.fullTimeRatio,
  });
  return Math.max(0, round2(cumulative - prior));
}

export default async function NewRequestPage() {
  const user = await requireAuth();
  const today = todayISO();
  const t = await getTranslations("newRequest");
  // Reconcile the current-user's balances (cumulative accrual + carry-over) so the
  // preview shows exactly what request validation will enforce.
  await syncCurrentAccruals(prisma, user.companyId!, user.id);

  const [leaveTypes, holidays, dbUser, balances, company] = await Promise.all([
    prisma.leaveType.findMany({
      where: { companyId: user.companyId, isArchived: false },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.holiday.findMany({
      where: { companyId: user.companyId, countryCode: "DE" },
    }),
    prisma.user.findUnique({ where: { id: user.id } }),
    prisma.leaveBalance.findMany({
      where: {
        userId: user.id,
        periodStart: { lte: today },
        periodEnd: { gte: today },
      },
      include: { leaveType: true },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } }),
  ]);

  // Lazy-seed missing balances: when a leave type was created before this user
  // was added (or vice versa), the balance row may not exist yet. Create any
  // missing current-period rows so the request form always shows the correct
  // available balance for every active leave type.
  const existingTypeIds = new Set(balances.map((b: (typeof balances)[number]) => b.leaveTypeId));
  const missingTypes = leaveTypes.filter((lt) => !existingTypeIds.has(lt.id));
  if (missingTypes.length > 0 && dbUser) {
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

    const newBalances: typeof balances = [];
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

      const accrued = computeAccrued({
        annualAllotment: policy.annualAllotment,
        employmentStartDate: dbUser.employmentStartDate,
        fullTimeRatio: ratio,
        periodStart: start,
        periodEnd: end,
        asOf: today,
        accrualMethod: policy.leaveType.accrualMethod,
      });

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
      newBalances.push(row);
    }
    balances.push(...newBalances);
  }

  const holidayDates = new Set(
    holidays.flatMap((h: (typeof holidays)[number]) =>
      h.isRecurring
        ? [`${today.slice(0, 4)}-${h.date.slice(5)}`, `${Number(today.slice(0, 4)) + 1}-${h.date.slice(5)}`]
        : [h.date],
    ),
  );

  const balanceByType = new Map(
    balances.map((b: (typeof balances)[number]) => [b.leaveTypeId, availableBalance(b)] as const),
  );

  const weekendRules = company.countWeekendsWithinSpan || company.extendWeekendAfterFriday;
  const halfDays = company.halfDayEnabled;
  const subtitleKey = weekendRules
    ? halfDays
      ? "subtitleWeekends"
      : "subtitleWeekendsNoHalfDays"
    : halfDays
      ? "subtitle"
      : "subtitleNoHalfDays";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(subtitleKey)}
        </p>
      </div>

      <RequestForm
        leaveTypes={leaveTypes.map((t: (typeof leaveTypes)[number]) => ({
          id: t.id,
          name: t.name,
          nameEn: t.nameEn,
          nameFr: t.nameFr,
          isPaid: t.isPaid,
          requiresApproval: t.requiresApproval,
          requiresAttachment: t.requiresAttachment,
        }))}
        balanceByType={balanceByType}
        holidayDates={holidayDates}
        employmentStartDate={dbUser?.employmentStartDate ?? null}
        countWeekendsWithinSpan={company.countWeekendsWithinSpan}
        extendWeekendAfterFriday={company.extendWeekendAfterFriday}
        countHolidaysAsVacationDays={company.countHolidaysAsVacationDays}
        halfDayEnabled={company.halfDayEnabled}
        halfDayStartDay={company.halfDayStartDay}
        halfDayEndDay={company.halfDayEndDay}
      />
    </div>
  );
}
