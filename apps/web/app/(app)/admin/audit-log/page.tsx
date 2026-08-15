import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole403 } from "@/lib/session";
import { AuditLogView } from "@/components/admin/audit-log-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminAuditLog") };
}

export default async function AdminAuditLogPage() {
  await requireRole403(["HR", "ADMIN", "MANAGER"]);
  const t = await getTranslations("auditLog");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      <AuditLogView />
    </div>
  );
}
