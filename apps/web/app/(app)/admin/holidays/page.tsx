import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { listHolidaysForAdmin } from "@/lib/services/holidays";
import { HolidayManagement } from "@/components/admin/holiday-management";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminHolidays") };
}

export default async function AdminHolidaysPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const t = await getTranslations("adminHolidays");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });
  const holidays = await listHolidaysForAdmin(user);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <HolidayManagement holidays={holidays} defaultCountryCode={company.countryCode} />
    </div>
  );
}
