import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { AdminTabs } from "@/components/admin/admin-tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // MANAGER is admitted so they can reach the audit log; every other admin
  // sub-page re-checks its own role and redirects non-HR users.
  const user = await requireRole(["HR", "ADMIN", "MANAGER"]);
  const t = await getTranslations("admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <AdminTabs user={user} />
      {children}
    </div>
  );
}
