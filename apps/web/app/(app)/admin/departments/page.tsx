import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { listDepartmentsForAdmin } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { CreateDepartmentDialog, RenameDepartmentDialog } from "@/components/admin/department-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminDepartments") };
}

export default async function AdminDepartmentsPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const departments = await listDepartmentsForAdmin(user);
  const t = await getTranslations("adminDepartments");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: departments.length })}
        </p>
        <CreateDepartmentDialog />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {departments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-foreground">{d.name}</p>
                  {d.code ? <Badge variant="neutral">{d.code}</Badge> : null}
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{d.users}</span>{" "}
                    {t("personCount", { count: d.users })}
                  </p>
                  <RenameDepartmentDialog id={d.id} name={d.name} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
