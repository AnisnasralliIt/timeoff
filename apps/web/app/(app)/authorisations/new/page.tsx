import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { authorisationPeriod, availableAuthorisationHours, todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import {
  authorisationBalanceFor,
  getAuthorisationPolicy,
} from "@/lib/services/authorisations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@timeoff/ui";
import { AuthorisationForm } from "@/components/authorisations/authorisation-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("authorisationsNew") };
}

export default async function NewAuthorisationPage() {
  const user = await requireAuth();
  const t = await getTranslations("authorisations");

  const policy = await getAuthorisationPolicy(prisma, user.companyId!);
  if (!policy?.enabled) {
    return (
      <EmptyState title={t("disabledTitle")} description={t("disabledDescription")} />
    );
  }

  const period = authorisationPeriod(todayISO());
  const balance = await authorisationBalanceFor(prisma, policy, user.id, period);
  const available = balance ? availableAuthorisationHours(balance) : 0;

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("newTitle")}</CardTitle>
          <CardDescription>{t("newSubtitle", { period })}</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthorisationForm
            minHours={policy.minRequestHours}
            maxHours={policy.maxRequestHours}
            incrementHours={policy.requestIncrementHours}
            available={available}
            periodStart={`${period}-01`}
            periodEnd={`${period}-31`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
