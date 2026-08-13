import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { listLeaveTypesForAdmin } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { CreateLeaveTypeDialog, EditPolicyDialog } from "@/components/admin/leave-type-forms";
import { LeaveTypeActions, ShowArchivedToggle } from "@/components/admin/leave-type-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminLeaveTypes") };
}

export default async function AdminLeaveTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ showArchived?: string }>;
}) {
  const user = await requireRole(["HR", "ADMIN"]);
  const { showArchived } = await searchParams;
  const showArchivedFlag = showArchived === "1";
  const leaveTypes = await listLeaveTypesForAdmin(user, { showArchived: showArchivedFlag });
  const t = await getTranslations("adminLeaveTypes");

  const visibleCount = showArchivedFlag
    ? leaveTypes.filter((type) => !type.isArchived).length
    : leaveTypes.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: visibleCount })}
        </p>
        <div className="flex items-center gap-2">
          <ShowArchivedToggle />
          <CreateLeaveTypeDialog />
        </div>
      </div>
      <div className="space-y-4">
        {leaveTypes.map((type: (typeof leaveTypes)[number]) => {
          const hasHistory = type._count.requests + type._count.balances > 0;
          return (
            <Card key={type.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ backgroundColor: type.color }}
                    />
                    {type.name}
                    {type.isArchived ? <Badge variant="neutral">{t("archived")}</Badge> : null}
                    {type.isSystem ? <Badge variant="neutral">{t("system")}</Badge> : null}
                    <Badge variant={type.requiresApproval ? "warning" : "success"}>
                      {type.requiresApproval ? t("approvalRequired") : t("autoApproved")}
                    </Badge>
                    {type.requiresAttachment ? (
                      <Badge variant="neutral">{t("attachmentRequired")}</Badge>
                    ) : null}
                  </CardTitle>
                  <LeaveTypeActions
                    leaveTypeId={type.id}
                    name={type.name}
                    isArchived={type.isArchived}
                    hasHistory={hasHistory}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {type.policies.map((policy: (typeof type.policies)[number]) => (
                  <div
                    key={policy.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{policy.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("allotment", { count: policy.annualAllotment })} ·{" "}
                        {t("carryOver", { count: policy.carryOverDays })}
                        {policy.carryOverExpiresOn ? ` ${t("expires", { date: policy.carryOverExpiresOn })}` : ""} ·{" "}
                        {t("probation", { count: policy.probationDays })} ·{" "}
                        {policy.negativeAllowed ? t("negativeAllowed") : t("noNegative")}
                        {policy.requiresApproval !== null ? ` · ${t("approval", { value: policy.requiresApproval ? t("required") : t("auto") })}` : ""}
                        {policy.requiresAttachment !== null ? ` · ${t("attachment", { value: policy.requiresAttachment ? t("required") : t("notRequired") })}` : ""}
                      </p>
                    </div>
                    <EditPolicyDialog policy={policy} />
                  </div>
                ))}
                {type.policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noPolicies")}</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {leaveTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showArchivedFlag ? t("noArchivedTypes") : t("noTypes")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
