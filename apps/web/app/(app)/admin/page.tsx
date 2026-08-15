import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  History,
  TriangleAlert,
  UserPlus,
  Users,
  UserRoundSearch,
  Wallet,
} from "lucide-react";
import { requireRole } from "@/lib/session";
import { adminStats } from "@/lib/services/admin";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@timeoff/ui";
import { ExportButton } from "@/components/export-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("admin") };
}

const iconTones: Record<string, string> = {
  primary: "bg-primary-subtle text-primary",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-destructive-subtle text-destructive",
  info: "bg-info-subtle text-info",
  neutral: "bg-secondary text-muted-foreground",
};

function StatCard({
  label,
  value,
  icon,
  tone = "primary",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: keyof typeof iconTones;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", iconTones[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-display text-2xl font-semibold leading-none text-foreground">{value}</p>
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeading({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
        {icon}
      </div>
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </div>
  );
}

function NeedsAttentionItem({
  label,
  count,
  href,
  icon,
  tone,
  description,
  examples,
}: {
  label: string;
  count: number;
  href: string;
  icon: React.ReactNode;
  tone: keyof typeof iconTones;
  description?: string;
  examples?: { name: string; reason?: string }[];
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", iconTones[tone])}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{label}</p>
            {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-display text-lg font-semibold leading-none text-foreground">{count}</span>
          <ArrowRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
      </div>
      {examples && examples.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2">
          {examples.map((ex) => (
            <span
              key={ex.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {ex.name}
              {ex.reason ? (
                <span className="rounded-full bg-warning-subtle px-1.5 py-px text-[10px] font-medium text-warning-subtle-foreground">
                  {ex.reason}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

function StatusRow({
  label,
  value,
  dotClass,
}: {
  label: string;
  value: number;
  dotClass: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="flex items-center gap-2 text-sm text-foreground">
        <span aria-hidden className={cn("size-2.5 rounded-full", dotClass)} />
        {label}
      </span>
      <span className="font-display text-base font-semibold leading-none text-foreground">{value}</span>
    </li>
  );
}

export default async function AdminOverviewPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const stats = await adminStats(user);
  const t = await getTranslations("admin");

  const attentionItems: {
    key: string;
    count: number;
    href: string;
    icon: React.ReactNode;
    tone: keyof typeof iconTones;
    description?: string;
    examples?: { name: string; reason?: string }[];
  }[] = [];
  const pending = stats.pendingApprovals;
  attentionItems.push({
    key: "attentionPendingApprovals",
    count: pending.total,
    href: "/approvals",
    icon: <ClipboardCheck className="size-4" />,
    tone: "warning" as const,
    description:
      pending.olderThan7 > 0
        ? t("attentionPendingOld7", { count: pending.olderThan3, old7: pending.olderThan7 })
        : pending.olderThan3 > 0
          ? t("attentionPendingOld3", { count: pending.olderThan3 })
          : undefined,
  });

  const missingUsers = stats.missingInfo;
  attentionItems.push({
    key: "attentionMissingInfo",
    count: missingUsers.total,
    href:
      missingUsers.total === 1 && missingUsers.users[0]
        ? `/admin/users?issue=missing&user=${missingUsers.users[0].id}`
        : "/admin/users?issue=missing",
    icon: <UserRoundSearch className="size-4" />,
    tone: "info" as const,
    examples: missingUsers.users.slice(0, 3).map((u) => ({
      name: u.name,
      reason: u.missing.map((f) => t(`missingField.${f}`)).join(", "),
    })),
  });

  const balanceIssue = stats.balanceIssue;
  const balanceUserIds = new Set(balanceIssue.rows.map((r) => r.userId));
  attentionItems.push({
    key: "attentionBalanceIssues",
    count: balanceIssue.total,
    href:
      balanceUserIds.size === 1
        ? `/admin/balances?issue=balance&user=${[...balanceUserIds][0]}`
        : "/admin/balances?issue=balance",
    icon: <TriangleAlert className="size-4" />,
    tone: "danger" as const,
    description: t("attentionBalanceBreakdown", {
      negative: balanceIssue.negative,
      inconsistent: balanceIssue.inconsistent,
    }),
    examples: balanceIssue.rows.slice(0, 3).map((r) => ({
      name: r.userName,
      reason: t(`balanceReason.${r.reason}`),
    })),
  });

  const transitioning = stats.employeeStatus.onboarding + stats.employeeStatus.offboarding;
  attentionItems.push({
    key: "attentionTransitioning",
    count: transitioning,
    href: "/admin/users",
    icon: <CircleDot className="size-4" />,
    tone: "primary" as const,
  });

  const quickActions = [
    { href: "/admin/users?new=1", key: "actionAddEmployee", icon: <UserPlus className="size-4" /> },
    { href: "/admin/balances", key: "actionManageBalances", icon: <Wallet className="size-4" /> },
    { href: "/admin/leave-types", key: "actionLeaveTypes", icon: <Briefcase className="size-4" /> },
    { href: "/admin/audit-log", key: "actionAuditLog", icon: <History className="size-4" /> },
  ] as const;

  const statusRows = [
    { key: "statusActive", value: stats.employeeStatus.active, dotClass: "bg-success" },
    { key: "statusOnboarding", value: stats.employeeStatus.onboarding, dotClass: "bg-info" },
    { key: "statusOffboarding", value: stats.employeeStatus.offboarding, dotClass: "bg-muted-foreground/60" },
    { key: "statusInactive", value: stats.employeeStatus.inactive, dotClass: "bg-warning" },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("totalEmployees")} value={stats.totalEmployees} icon={<Users className="size-5" />} tone="primary" />
        <StatCard label={t("requestsPending")} value={stats.pendingRequests} icon={<ClipboardCheck className="size-5" />} tone="warning" />
        <StatCard label={t("upcomingLeave")} value={stats.upcoming} icon={<CalendarDays className="size-5" />} tone="info" />
        <StatCard label={t("departments")} value={stats.departments} icon={<Building2 className="size-5" />} tone="neutral" />
        <StatCard label={t("leaveTypes")} value={stats.leaveTypes} icon={<Briefcase className="size-5" />} tone="neutral" />
        <StatCard label={t("activeDelegations")} value={stats.delegations} icon={<CalendarClock className="size-5" />} tone="neutral" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <SectionHeading
              title={t("needsAttentionTitle")}
              description={t("needsAttentionDescription")}
              icon={<TriangleAlert className="size-4" />}
            />
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-success-subtle-foreground">
                <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{t("allClearTitle")}</p>
                  <p className="text-xs opacity-80">{t("allClearDescription")}</p>
                </div>
              </div>
            ) : (
              <ul className="grid gap-2">
                {attentionItems.map((item) => (
                  <li key={item.key}>
                    <NeedsAttentionItem
                      label={t(item.key)}
                      count={item.count}
                      href={item.href}
                      icon={item.icon}
                      tone={item.tone}
                      description={item.description}
                      examples={item.examples}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              title={t("quickActionsTitle")}
              description={t("quickActionsDescription")}
              icon={<UserPlus className="size-4" />}
            />
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {quickActions.map((action) => (
                <Button key={action.href} asChild variant="outline" className="justify-start">
                  <Link href={action.href}>
                    {action.icon}
                    {t(action.key)}
                  </Link>
                </Button>
              ))}
              <ExportButton variant="all" className="w-full justify-start" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionHeading
              title={t("employeeStatusTitle")}
              description={t("employeeStatusDescription")}
              icon={<Users className="size-4" />}
            />
          </CardHeader>
          <CardContent>
            <ul>
              {statusRows.map((row) => (
                <StatusRow key={row.key} label={t(row.key)} value={row.value} dotClass={row.dotClass} />
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-3">
              <span className="text-sm font-medium text-foreground">{t("statusTotal")}</span>
              <span className="font-display text-base font-semibold leading-none text-foreground">
                {stats.totalEmployees}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeading
              title={t("balanceSummaryTitle")}
              description={t("balanceSummaryDescription")}
              icon={<Wallet className="size-4" />}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
                <Wallet className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold leading-none text-foreground">
                  {stats.available.toFixed(1)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("totalAvailableLabel")}</p>
              </div>
            </div>
            {stats.balanceTotals.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-3">
                {stats.balanceTotals.map((row) => {
                  const total = row.available + row.used;
                  const pct = total > 0 ? Math.round((row.available / total) * 100) : 0;
                  return (
                    <li key={row.name}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium text-foreground">{row.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("daysUsed", { count: row.used })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right font-display text-base font-semibold leading-none text-foreground">
                          {row.available.toFixed(1)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {t("employeesWithBalances", { count: stats.balanceEmployees })}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
