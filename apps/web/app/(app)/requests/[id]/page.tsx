import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, Download, FileText, Paperclip } from "lucide-react";
import { prisma } from "@timeoff/db";
import { requireAuth } from "@/lib/session";
import { canUserDecide } from "@/lib/services/leave";
import { listAttachmentsForRequest, canViewRequest } from "@/lib/services/attachments";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, type BadgeProps } from "@timeoff/ui";
import { ApproveButton, RejectRequestDialog } from "@/components/approval-actions";
import { AddAttachmentButton, DeleteAttachmentButton } from "@/components/attachment-actions";
import { CancelRequestDialog } from "@/components/cancel-request-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("request") };
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

function formatSpan(start: string, end: string, startPart: string, endPart: string): string {
  const part = (p: string) => (p === "FULL" ? "" : p === "FIRST_HALF" ? " (AM)" : " (PM)");
  if (start === end) return `${start}${part(startPart)}`;
  return `${start}${part(startPart)} – ${end}${part(endPart)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id } = await params;
  const t = await getTranslations("requestDetail");
  const tStatus = await getTranslations("status");
  const tCommon = await getTranslations("common");

  const request = await prisma.leaveRequest.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      user: { include: { department: true } },
      leaveType: true,
      approvalSteps: { include: { approver: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      approvedBy: { select: { name: true } },
    },
  });

  if (!request) notFound();
  if (!(await canViewRequest(request, user))) notFound();

  const attachments = await listAttachmentsForRequest(user, id);
  const canDecide = await canUserDecide(user, id);
  const isOwner = request.userId === user.id;
  const canManageFiles = isOwner || user.role === "HR" || user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const cancellable =
    isOwner &&
    (request.status === "PENDING" ||
      (request.status === "APPROVED" && request.startDate > new Date().toISOString().slice(0, 10)));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground">
            {isOwner ? t("titleMine") : t("titleFrom", { name: request.user.name })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {cancellable ? <CancelRequestDialog requestId={request.id} /> : null}
          {canDecide ? (
            <>
              <RejectRequestDialog requestId={request.id} />
              <ApproveButton requestId={request.id} />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(request.status)}>{tStatus(request.status)}</Badge>
        <Badge
          variant="neutral"
          className="flex items-center gap-1.5"
          style={{ borderColor: `${request.leaveType.color}66` }}
        >
          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: request.leaveType.color }} />
          {request.leaveType.name}
        </Badge>
        {request.leaveType.requiresAttachment ? (
          <Badge variant="neutral" className="font-normal">
            <Paperclip className="mr-1 size-3" />
            {t("attachmentRequired")}
          </Badge>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <dl className="grid gap-4 px-6 py-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("dates")}</dt>
              <dd className="mt-1 text-sm font-medium">
                {formatSpan(request.startDate, request.endDate, request.startDayPart, request.endDayPart)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("workingDays")}</dt>
              <dd className="mt-1 text-sm font-medium">
                {tCommon("dayCount", { count: request.totalDays })}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("requester")}</dt>
              <dd className="mt-1 text-sm font-medium">
                {request.user.name}
                <span className="ml-1 text-muted-foreground">· {request.user.department?.name ?? "—"}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("submitted")}</dt>
              <dd className="mt-1 text-sm font-medium">{formatDate(request.createdAt)}</dd>
            </div>
            {request.reason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("reason")}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">“{request.reason}”</dd>
              </div>
            ) : null}
            {request.rejectionReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("rejectionReason")}</dt>
                <dd className="mt-1 text-sm text-destructive">“{request.rejectionReason}”</dd>
              </div>
            ) : null}
            {request.approvedById && request.approvedBy ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("finalApproval")}</dt>
                <dd className="mt-1 text-sm font-medium">
                  {request.approvedBy.name}
                  {request.approvedAt ? ` · ${formatDate(request.approvedAt)}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-muted-foreground" />
            {t("approvalHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {request.approvalSteps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {request.status === "APPROVED" ? t("waitingFirstApproval") : t("waitingFirstApprovalInitial")}
            </p>
          ) : (
            <ol className="space-y-4">
              {request.approvalSteps.map((step: (typeof request.approvalSteps)[number], i: number) => (
                <li key={step.id} className="relative flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 size-3 rounded-full ring-4 ring-card ${
                        step.action === "APPROVED" ? "bg-success" : "bg-destructive"
                      }`}
                    />
                    {i < request.approvalSteps.length - 1 ? (
                      <span className="w-px flex-1 bg-border" />
                    ) : null}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-medium">
                      {t("levelStep", {
                        level: step.level,
                        action: step.action === "APPROVED" ? t("approved") : t("rejected"),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {step.approver?.name ?? t("approverDeleted")} · {formatDate(step.createdAt)}
                      {step.comment ? ` · “${step.comment}”` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Paperclip className="size-4 text-muted-foreground" />
            {t("attachments")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {attachments.length === 0 ? null : (
              <span className="text-sm text-muted-foreground">
                {tCommon("fileCount", { count: attachments.length })}
              </span>
            )}
            {canManageFiles ? <AddAttachmentButton requestId={request.id} /> : null}
          </div>
        </CardHeader>
        <CardContent>
          {attachments.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title={t("noFiles")}
              description={t("noFilesDescription")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {attachments.map((attachment: (typeof attachments)[number]) => (
                <li key={attachment.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{attachment.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(attachment.sizeBytes)} · {attachment.uploaderName} ·{" "}
                      {formatDate(attachment.createdAt)}
                      {attachment.kind === "MEDICAL_CERTIFICATE" ? (
                        <>
                          {" "}
                          · <span className="font-medium text-foreground">{t("medicalCertificate")}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/api/attachments/${attachment.id}`} prefetch={false}>
                        <Download className="size-3.5" />
                        {t("download")}
                      </Link>
                    </Button>
                    {canManageFiles ? (
                      <DeleteAttachmentButton attachmentId={attachment.id} requestId={request.id} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
