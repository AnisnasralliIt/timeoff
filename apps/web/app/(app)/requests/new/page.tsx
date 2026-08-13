import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { availableBalance, todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { syncCurrentAccruals } from "@/lib/services/leave";
import { RequestForm } from "@/components/request-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("newRequest") };
}

export default async function NewRequestPage() {
  const user = await requireAuth();
  const today = todayISO();
  const t = await getTranslations("newRequest");
  // Reconcile the current-year balances (cumulative accrual + carry-over) so the
  // preview shows exactly what request validation will enforce.
  await syncCurrentAccruals(prisma, user.companyId!);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(weekendRules ? "subtitleWeekends" : "subtitle")}
        </p>
      </div>

      <RequestForm
        leaveTypes={leaveTypes.map((t: (typeof leaveTypes)[number]) => ({
          id: t.id,
          name: t.name,
          isPaid: t.isPaid,
          requiresApproval: t.requiresApproval,
          requiresAttachment: t.requiresAttachment,
        }))}
        balanceByType={balanceByType}
        holidayDates={holidayDates}
        employmentStartDate={dbUser?.employmentStartDate ?? null}
        countWeekendsWithinSpan={company.countWeekendsWithinSpan}
        extendWeekendAfterFriday={company.extendWeekendAfterFriday}
      />
    </div>
  );
}
