import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardCheck } from "lucide-react";
import { requireAuth } from "@/lib/session";
import { listPendingForApproval } from "@/lib/services/leave";
import { Badge, Card, CardContent, EmptyState, type BadgeProps } from "@timeoff/ui";
import { ApproveButton, RejectRequestDialog } from "@/components/approval-actions";
import DelegationPanel from "@/components/delegation-panel";

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
  const t = await getTranslations("approvals");
  const tCommon = await getTranslations("common");
  const tTime = await getTranslations("timeAgo");
  const locale = await getLocale();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending.length === 0
            ? t("nothingWaiting")
            : t("countWaiting", { count: pending.length })}
        </p>
      </div>

      {pending.length === 0 ? (
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
                      {request.leaveType.name} · {t("submitted", { time: timeAgo(request.createdAt, locale, tTime) })}
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

      <DelegationPanel user={user} />
    </div>
  );
}
