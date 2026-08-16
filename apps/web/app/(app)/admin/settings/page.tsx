import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { getAuthorisationPolicy } from "@/lib/services/authorisations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@timeoff/ui";
import { CompanySettingsForm } from "@/components/admin/company-settings-form";
import { WeekendCalculator } from "@/components/admin/weekend-calculator";
import { AuthorisationPolicyForm } from "@/components/admin/authorisation-policy-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminSettings") };
}

export default async function AdminSettingsPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const t = await getTranslations("adminSettings");
  const tPolicy = await getTranslations("authorisationsPolicy");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });
  const policy = await getAuthorisationPolicy(prisma, user.companyId!);

  const now = new Date();
  const thisYear = now.getFullYear();
  const [start, end] = [
    `${thisYear - 1}-01-01`,
    `${thisYear + 1}-12-31`,
  ];
  const holidays = await prisma.holiday.findMany({ where: { companyId: company.id } });
  const holidayDates = new Set<string>();
  for (const row of holidays) {
    if (row.isRecurring) {
      for (let year = thisYear - 1; year <= thisYear + 1; year++) {
        const instance = `${year}-${row.date.slice(5)}`;
        if (instance >= start && instance <= end) holidayDates.add(instance);
      }
    } else if (row.date >= start && row.date <= end) {
      holidayDates.add(row.date);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanySettingsForm
            countWeekendsWithinSpan={company.countWeekendsWithinSpan}
            extendWeekendAfterFriday={company.extendWeekendAfterFriday}
            countHolidaysAsVacationDays={company.countHolidaysAsVacationDays}
            halfDayEnabled={company.halfDayEnabled}
            halfDayStartDay={company.halfDayStartDay}
            halfDayEndDay={company.halfDayEndDay}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("calculatorTitle")}</CardTitle>
          <CardDescription>{t("calculatorDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <WeekendCalculator
            countWeekendsWithinSpan={company.countWeekendsWithinSpan}
            extendWeekendAfterFriday={company.extendWeekendAfterFriday}
            countHolidaysAsVacationDays={company.countHolidaysAsVacationDays}
            holidayDates={[...holidayDates]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tPolicy("title")}</CardTitle>
          <CardDescription>{tPolicy("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthorisationPolicyForm
            enabled={policy?.enabled ?? false}
            monthlyAllowance={policy?.monthlyAllowance ?? 4}
            minRequestHours={policy?.minRequestHours ?? 2}
            maxRequestHours={policy?.maxRequestHours ?? 4}
            requestIncrementHours={policy?.requestIncrementHours ?? 2}
            carryOverEnabled={policy?.carryOverEnabled ?? false}
            maxCarryOverHours={policy?.maxCarryOverHours ?? 4}
            prorateFirstMonth={policy?.prorateFirstMonth ?? false}
            requiresApproval={policy?.requiresApproval ?? true}
          />
        </CardContent>
      </Card>
    </div>
  );
}
