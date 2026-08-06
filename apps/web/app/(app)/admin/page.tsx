import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Users, ClipboardCheck, Building2, Briefcase, CalendarClock, Wallet, CalendarDays } from "lucide-react";
import { requireRole } from "@/lib/session";
import { adminStats } from "@/lib/services/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("admin") };
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const stats = await adminStats(user);
  const t = await getTranslations("admin");

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label={t("activeEmployees")} value={stats.activeUsers} icon={<Users className="size-5" />} />
      <StatCard label={t("requestsPending")} value={stats.pendingRequests} icon={<ClipboardCheck className="size-5" />} />
      <StatCard label={t("departments")} value={stats.departments} icon={<Building2 className="size-5" />} />
      <StatCard label={t("leaveTypes")} value={stats.leaveTypes} icon={<Briefcase className="size-5" />} />
      <StatCard label={t("activeDelegations")} value={stats.delegations} icon={<CalendarClock className="size-5" />} />
      <StatCard label={t("upcomingLeave")} value={stats.upcoming} icon={<CalendarDays className="size-5" />} />

      <Card className="sm:col-span-2 lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">{t("snapshotTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary">
              <Wallet className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-display text-2xl font-semibold text-foreground">
                {stats.available.toFixed(1)}
              </span>{" "}
              {t("vacationDaysAvailable")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
