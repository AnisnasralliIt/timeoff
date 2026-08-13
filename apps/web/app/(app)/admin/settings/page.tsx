import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@timeoff/ui";
import { CompanySettingsForm } from "@/components/admin/company-settings-form";
import { WeekendCalculator } from "@/components/admin/weekend-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminSettings") };
}

export default async function AdminSettingsPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const t = await getTranslations("adminSettings");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });

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
            holidayDates={[...holidayDates]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
