import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { listUsersForAdmin, usersWithMissingInfo } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { CreateUserDialog } from "@/components/admin/create-user-form";
import { EditUserDialog } from "@/components/admin/edit-user-form";
import { DeleteUserDialog } from "@/components/admin/delete-user-dialog";
import { ChangePasswordDialog } from "@/components/admin/change-password-dialog";
import { roleBadgeVariant } from "@/components/admin/user-badges";
import { SUPERVISOR_ROLES } from "@/lib/permissions";

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

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; issue?: string; user?: string }>;
}) {
  const user = await requireRole(["HR", "ADMIN"]);
  const params = await searchParams;
  const t = await getTranslations("adminUsers");
  const tAdmin = await getTranslations("admin");
  const tRole = await getTranslations("roles");
  const tUserStatus = await getTranslations("userStatus");
  const tCommon = await getTranslations("common");
  const [users, departments, managers, missingUsers] = await Promise.all([
    listUsersForAdmin(user),
    prisma.department.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      where: { companyId: user.companyId, status: "ACTIVE", role: { in: [...SUPERVISOR_ROLES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    usersWithMissingInfo(user),
  ]);
  const canGrantAdmin = user.role === "SUPER_ADMIN";
  const missingById = new Map(missingUsers.map((m: (typeof missingUsers)[number]) => [m.id, m.missing]));
  const issueMissing = params.issue === "missing";
  const visibleUsers = issueMissing ? users.filter((u: (typeof users)[number]) => missingById.has(u.id)) : users;
  const targetUser = params.user ? users.find((u: (typeof users)[number]) => u.id === params.user) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {issueMissing ? (
          <p className="text-sm text-muted-foreground">
            {t("filteredToMissing", { count: visibleUsers.length })}{" "}
            <Link href="/admin/users" className="underline underline-offset-2 hover:text-foreground">
              {t("showAllEmployees")}
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("count", { count: users.length })}</p>
        )}
        <CreateUserDialog
          departments={departments}
          managers={managers}
          canGrantAdmin={canGrantAdmin}
          defaultOpen={params.new === "1"}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {visibleUsers.map((u: (typeof users)[number]) => (
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
                    {missingById.has(u.id) ? (
                      <Badge variant="warning" className="font-normal">
                        {t("missingFields", {
                          fields: missingById.get(u.id)!.map((f) => tAdmin(`missingField.${f}`)).join(", "),
                        })}
                      </Badge>
                    ) : null}
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
                    defaultOpen={targetUser?.id === u.id}
                  />
                  <ChangePasswordDialog userId={u.id} name={u.name} />
                  <DeleteUserDialog userId={u.id} name={u.name} isSelf={u.id === user.id} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
