import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { availableBalance, todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { RequestForm } from "@/components/request-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("newRequest") };
}

export default async function NewRequestPage() {
  const user = await requireAuth();
  const today = todayISO();
  const t = await getTranslations("newRequest");

  const [leaveTypes, holidays, dbUser, balances] = await Promise.all([
    prisma.leaveType.findMany({
      where: { companyId: user.companyId },
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
  ]);

  const holidayDates = new Set(
    holidays.flatMap((h) =>
      h.isRecurring
        ? [`${today.slice(0, 4)}-${h.date.slice(5)}`, `${Number(today.slice(0, 4)) + 1}-${h.date.slice(5)}`]
        : [h.date],
    ),
  );

  const balanceByType = new Map(
    balances.map((b: (typeof balances)[number]) => [b.leaveTypeId, availableBalance(b)]),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle")}
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
      />
    </div>
  );
}
