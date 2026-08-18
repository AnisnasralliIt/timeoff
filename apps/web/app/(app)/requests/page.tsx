import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Inbox, Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { todayISO } from "@timeoff/domain";
import { requireAuth } from "@/lib/session";
import { Badge, Button, Card, CardContent, EmptyState, type BadgeProps } from "@timeoff/ui";
import { CancelRequestDialog } from "@/components/cancel-request-dialog";
import { resolveLeaveTypeName } from "@/lib/leave-type-name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("requests") };
}

function statusVariant(status: string): BadgeProps["variant"] {
  const map: Record<string, BadgeProps["variant"]> = {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    cancelled: "neutral",
    draft: "neutral",
  };
  return map[status.toLowerCase()] ?? "neutral";
}

function formatSpan(start: string, end: string, startPart: string, endPart: string, tDayPart: (key: string) => string): string {
  const part = (p: string) => {
    if (p === "FULL") return "";
    return ` (${p === "FIRST_HALF" ? tDayPart("FIRST_HALF_SHORT") : tDayPart("SECOND_HALF_SHORT")})`;
  };
  if (start === end) return `${start}${part(startPart)}`;
  return `${start}${part(startPart)} – ${end}${part(endPart)}`;
}

export default async function RequestsPage() {
  const user = await requireAuth();
  const today = todayISO();
  const t = await getTranslations("requests");
  const tStatus = await getTranslations("status");
  const tCommon = await getTranslations("common");
  const tDayPart = await getTranslations("dayPart");
  const locale = await getLocale();

  const requests = await prisma.leaveRequest.findMany({
    where: { userId: user.id },
    include: {
      leaveType: true,
      _count: { select: { attachments: { where: { deletedAt: null } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId! } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { count: requests.length })}
          </p>
        </div>
        <Button asChild>
          <Link href="/requests/new">
            <CalendarPlus className="size-4" />
            {t("newRequest")}
          </Link>
        </Button>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("emptyTitle")}
          description={t(company.countWeekendsWithinSpan || company.extendWeekendAfterFriday ? "emptyDescriptionWeekends" : "emptyDescription")}
          action={
            <Button asChild>
              <Link href="/requests/new">{t("requestLeave")}</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {requests.map((request: (typeof requests)[number]) => {
                const cancellable = request.status === "PENDING" ||
                  (request.status === "APPROVED" && request.startDate > today);
                return (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <Link href={`/requests/${request.id}`} className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {formatSpan(
                            request.startDate,
                            request.endDate,
                            request.startDayPart,
                            request.endDayPart,
                            tDayPart,
                          )}
                        </p>
                        <Badge variant={statusVariant(request.status)}>
                          {tStatus(request.status)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {resolveLeaveTypeName(request.leaveType, locale)} · {tCommon("dayCount", { count: request.totalDays })}
                        {request.reason ? ` · “${request.reason}”` : ""}
                        {request.rejectionReason ? (
                          <span className="text-destructive"> · {t("rejected", { reason: request.rejectionReason })}</span>
                        ) : null}
                      </p>
                      {request._count.attachments > 0 ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Paperclip className="size-3" />
                          {tCommon("fileCount", { count: request._count.attachments })}
                        </p>
                      ) : null}
                    </Link>
                    {cancellable ? (
                      <CancelRequestDialog requestId={request.id} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
