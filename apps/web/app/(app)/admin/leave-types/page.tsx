import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { listLeaveTypesForAdmin } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { CreateLeaveTypeDialog, EditPolicyDialog } from "@/components/admin/leave-type-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminLeaveTypes") };
}

export default async function AdminLeaveTypesPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const leaveTypes = await listLeaveTypesForAdmin(user);
  const t = await getTranslations("adminLeaveTypes");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: leaveTypes.length })}
        </p>
        <CreateLeaveTypeDialog />
      </div>
      <div className="space-y-4">
        {leaveTypes.map((type: (typeof leaveTypes)[number]) => (
          <Card key={type.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: type.color }}
                />
                {type.name}
                {type.isSystem ? <Badge variant="neutral">{t("system")}</Badge> : null}
                <Badge variant={type.requiresApproval ? "warning" : "success"}>
                  {type.requiresApproval ? t("approvalRequired") : t("autoApproved")}
                </Badge>
                {type.requiresAttachment ? (
                  <Badge variant="neutral">{t("attachmentRequired")}</Badge>
                ) : null}
              </CardTitle>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
