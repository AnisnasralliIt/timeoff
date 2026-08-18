import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardCheck } from "lucide-react";
import { prisma } from "@timeoff/db";
import { requireAuth } from "@/lib/session";
import { listPendingForApproval } from "@/lib/services/leave";
import { getAuthorisationPolicy, listPendingAuthorisations } from "@/lib/services/authorisations";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, type BadgeProps } from "@timeoff/ui";
import { ApproveButton, RejectRequestDialog } from "@/components/approval-actions";
import { ApproveAuthorisationButton, RejectAuthorisationDialog } from "@/components/authorisations/authorisation-actions";
import DelegationPanel from "@/components/delegation-panel";
import { resolveLeaveTypeName } from "@/lib/leave-type-name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("approvals") };
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

function formatSpan(start: string, end: string): string {
  return start === end ? start : `${start} – ${end}`;
}

function timeAgo(
  date: Date,
  locale: string,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("justNow");
  if (mins < 60) return t("minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("days", { count: days });
  return date.toLocaleDateString(locale);
}

export default async function ApprovalsPage() {
  const user = await requireAuth();
  if (user.role === "EMPLOYEE") redirect("/dashboard");
  const pending = await listPendingForApproval(user);
  const policy = await getAuthorisationPolicy(prisma, user.companyId!);
  const pendingAuthorisations = policy?.enabled ? await listPendingAuthorisations(user) : [];
  const t = await getTranslations("approvals");
  const tAuth = await getTranslations("authorisations");
  const tCommon = await getTranslations("common");
  const tTime = await getTranslations("timeAgo");
  const locale = await getLocale();

  const totalWaiting = pending.length + pendingAuthorisations.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalWaiting === 0
            ? t("nothingWaiting")
            : t("countWaiting", { count: totalWaiting })}
        </p>
      </div>

      {totalWaiting === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-6" />}
          title={t("allCaughtUp")}
          description={t("description")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {pending.map((request: (typeof pending)[number]) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/requests/${request.id}`}
                        className="text-sm font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {request.user.name}
                      </Link>
                      <Badge variant="neutral" className="font-normal">
                        {request.user.department?.name ?? "—"}
                      </Badge>
                      <Badge
                        variant={statusVariant(request.status)}
                      >
                        {t("pending")}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatSpan(request.startDate, request.endDate)} ·{" "}
                      {tCommon("dayCount", { count: request.totalDays })} ·{" "}
                      {resolveLeaveTypeName(request.leaveType, locale)} · {t("submitted", { time: timeAgo(request.createdAt, locale, tTime) })}
                    </p>
                    {request.reason ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground italic">
                        “{request.reason}”
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RejectRequestDialog requestId={request.id} />
                    <ApproveButton requestId={request.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {pendingAuthorisations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tAuth("pendingApprovalsTitle")}</CardTitle>
            <CardDescription>{tAuth("pendingApprovalsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {pendingAuthorisations.map((request: (typeof pendingAuthorisations)[number]) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{request.user.name}</span>
                      <Badge variant="neutral" className="font-normal">
                        {request.user.department?.name ?? "—"}
                      </Badge>
                      <Badge variant="warning">{t("pending")}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {request.date} ·{" "}
                      {request.startTime && request.endTime
                        ? `${request.startTime}–${request.endTime}`
                        : tAuth("hours", { count: request.hours })}{" "}
                      · {t("submitted", { time: timeAgo(request.createdAt, locale, tTime) })}
                    </p>
                    {request.reason ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground italic">“{request.reason}”</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RejectAuthorisationDialog requestId={request.id} />
                    <ApproveAuthorisationButton requestId={request.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <DelegationPanel user={user} />
    </div>
  );
}
