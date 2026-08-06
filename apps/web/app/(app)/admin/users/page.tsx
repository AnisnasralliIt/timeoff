import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { listUsersForAdmin } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { CreateUserDialog } from "@/components/admin/create-user-form";
import { EditUserDialog } from "@/components/admin/edit-user-form";
import { roleBadgeVariant } from "@/components/admin/user-badges";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminUsers") };
}

function statusVariant(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "INACTIVE":
      return "warning" as const;
    case "OFFBOARDED":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
}

export default async function AdminUsersPage() {
  const user = await requireRole(["HR", "ADMIN"]);
  const t = await getTranslations("adminUsers");
  const tRole = await getTranslations("roles");
  const tUserStatus = await getTranslations("userStatus");
  const tCommon = await getTranslations("common");
  const [users, departments, managers] = await Promise.all([
    listUsersForAdmin(user),
    prisma.department.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      where: { companyId: user.companyId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const canGrantAdmin = user.role === "SUPER_ADMIN";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: users.length })}
        </p>
        <CreateUserDialog departments={departments} managers={managers} canGrantAdmin={canGrantAdmin} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{u.name}</p>
                    <Badge variant={roleBadgeVariant(u.role)} className="font-normal">
                      {tRole(u.role)}
                    </Badge>
                    <Badge variant={statusVariant(u.status)} className="font-normal">
                      {tUserStatus(u.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {u.email} · {u.department ?? t("noDepartment")}
                    {u.manager ? ` · ${t("reportsTo", { name: u.manager })}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">
                      {u.vacationAvailable === null ? "—" : tCommon("dayCount", { count: u.vacationAvailable })}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("vacationLeft")}</p>
                  </div>
                  <EditUserDialog
                    user={u}
                    departments={departments}
                    managers={managers}
                    canGrantAdmin={canGrantAdmin}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
