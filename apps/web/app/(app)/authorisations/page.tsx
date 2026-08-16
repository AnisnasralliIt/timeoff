import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Hourglass, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { authorisationPeriod, availableAuthorisationHours, todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { PEOPLE_OPS_ROLES } from "@/lib/permissions";
import {
  authorisationBalanceFor,
  authorisationHistoryFor,
  getAuthorisationPolicy,
  listAuthorisationRequests,
  type AuthorisationHistoryPeriod,
} from "@/lib/services/authorisations";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, type BadgeProps } from "@timeoff/ui";
import { AuthorisationAdjustDialog } from "@/components/authorisations/authorisation-adjust-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("authorisations") };
}

function statusVariant(status: string): BadgeProps["variant"] {
  const map: Record<string, BadgeProps["variant"]> = {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    cancelled: "neutral",
  };
  return map[status.toLowerCase()] ?? "neutral";
}

function requestRangeLabel(
  request: { startTime: string | null; endTime: string | null; hours: number },
  formatHours: (key: string, values: { count: number }) => string,
): string {
  return request.startTime && request.endTime
    ? `${request.startTime}–${request.endTime}`
    : formatHours("hours", { count: request.hours });
}

function periodLabel(period: string): string {
  return new Date(`${period}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default async function AuthorisationsPage() {
  const user = await requireAuth();
  const t = await getTranslations("authorisations");
  const tStatus = await getTranslations("status");

  const policy = await getAuthorisationPolicy(prisma, user.companyId!);
  if (!policy?.enabled) {
    return (
      <EmptyState
        icon={<Hourglass className="size-6" />}
        title={t("disabledTitle")}
        description={t("disabledDescription")}
      />
    );
  }

  const isPeopleOps = PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE");
  const period = authorisationPeriod(todayISO());
  const [balance, history, requests, users] = await Promise.all([
    authorisationBalanceFor(prisma, policy, user.id, period),
    authorisationHistoryFor(user, user.id),
    listAuthorisationRequests(user),
    isPeopleOps
      ? prisma.user.findMany({
          where: { companyId: user.companyId, status: "ACTIVE" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const available = balance ? availableAuthorisationHours(balance) : 0;
  const upcoming = requests.filter(
    (r: (typeof requests)[number]) => r.date >= todayISO() && (r.status === "APPROVED" || r.status === "PENDING"),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { period: periodLabel(period) })}</p>
        </div>
        <div className="flex items-center gap-2">
          {isPeopleOps ? <AuthorisationAdjustDialog users={users} /> : null}
          <Button asChild>
            <Link href="/authorisations/new">
              <Plus className="size-4" />
              {t("newRequest")}
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            {t("balanceTitle")}
          </CardTitle>
          <CardDescription>{t("balanceSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {balance ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div className="col-span-2 rounded-md border border-border p-4">
                <dt className="text-xs text-muted-foreground">{t("available")}</dt>
                <dd className="mt-1 font-display text-2xl font-semibold">{t("hours", { count: available })}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-xs text-muted-foreground">{t("granted")}</dt>
                <dd className="mt-1 text-lg font-medium">{t("hours", { count: balance.granted })}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-xs text-muted-foreground">{t("carriedOver")}</dt>
                <dd className="mt-1 text-lg font-medium">{t("hours", { count: balance.carriedOver })}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-xs text-muted-foreground">{t("used")}</dt>
                <dd className="mt-1 text-lg font-medium">{t("hours", { count: balance.used })}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-xs text-muted-foreground">{t("pending")}</dt>
                <dd className="mt-1 text-lg font-medium">{t("hours", { count: balance.pending })}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noBalanceYet")}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("upcomingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingUpcoming")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((r: (typeof upcoming)[number]) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.date}</p>
                      <p className="truncate text-xs text-muted-foreground">{requestRangeLabel(r, t)}</p>
                    </div>
                    <Badge variant={statusVariant(r.status)}>{tStatus(r.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("recentTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noRequestsYet")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {requests.slice(0, 5).map((r: (typeof requests)[number]) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.date}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {requestRangeLabel(r, t)}
                        {r.reason ? ` · “${r.reason}”` : ""}
                      </p>
                    </div>
                    <Badge variant={statusVariant(r.status)}>{tStatus(r.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
          <CardDescription>{t("historySubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHistoryYet")}</p>
          ) : (
            <div className="space-y-6">
              {history.map((periodRow: AuthorisationHistoryPeriod) => (
                <div key={periodRow.period} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {periodLabel(periodRow.period)}
                      {periodRow.isCurrent ? (
                        <Badge variant="neutral" className="ml-2 font-normal">
                          {t("currentPeriod")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("available")} · {t("hours", { count: periodRow.available })}
                    </p>
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex gap-1.5">
                      <dt>{t("granted")}</dt>
                      <dd className="font-medium text-foreground">{t("hours", { count: periodRow.granted })}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t("carriedOver")}</dt>
                      <dd className="font-medium text-foreground">{t("hours", { count: periodRow.carriedOver })}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t("adjustment")}</dt>
                      <dd className="font-medium text-foreground">
                        {periodRow.adjustment > 0 ? "+" : ""}
                        {t("hours", { count: periodRow.adjustment })}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t("used")}</dt>
                      <dd className="font-medium text-foreground">{t("hours", { count: periodRow.used })}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t("pending")}</dt>
                      <dd className="font-medium text-foreground">{t("hours", { count: periodRow.pending })}</dd>
                    </div>
                  </dl>
                  {periodRow.requests.length > 0 ? (
                    <ul className="space-y-1">
                      {periodRow.requests.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-xs">
                          <span className="text-foreground">
                            {r.date} · {requestRangeLabel(r, t)}
                            {r.reason ? ` · “${r.reason}”` : ""}
                          </span>
                          <Badge variant={statusVariant(r.status)}>{tStatus(r.status)}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {periodRow.adjustments.length > 0 ? (
                    <ul className="space-y-1">
                      {periodRow.adjustments.map((a) => (
                        <li key={a.id} className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
                          {a.delta > 0 ? "+" : ""}
                          {t("hours", { count: a.delta })} · {a.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
