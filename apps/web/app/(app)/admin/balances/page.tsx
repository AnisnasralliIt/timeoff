import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { listBalancesForAdmin } from "@/lib/services/admin";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { BalanceAdjustDialog, BalanceRowSummary } from "@/components/admin/balance-adjust-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminBalances") };
}

export default async function AdminBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; type?: string }>;
}) {
  const user = await requireRole(["HR", "ADMIN"]);
  const params = await searchParams;
  const t = await getTranslations("adminBalances");

  const [users, leaveTypes, rows] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.leaveType.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    listBalancesForAdmin(user, { userId: params.user, leaveTypeId: params.type }),
  ]);

  const periodStarts = await prisma.leaveBalance.findMany({
    where: { companyId: user.companyId },
    select: { periodStart: true },
    distinct: ["periodStart"],
    orderBy: { periodStart: "desc" },
  });
  const periodOptions = periodStarts.map((p) => ({
    start: p.periodStart,
    label: t("leaveYearOption", { year: p.periodStart.slice(0, 4) }),
  }));

  const byUser = new Map<string, { name: string; email: string; rows: (typeof rows)[number][] }>();
  for (const row of rows) {
    const key = row.userEmail;
    if (!byUser.has(key)) byUser.set(key, { name: row.userName, email: row.userEmail, rows: [] });
    byUser.get(key)!.rows.push(row);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: rows.length, selected: params.user ? "true" : "false" })}
        </p>
        <BalanceAdjustDialog users={users} leaveTypes={leaveTypes} periodOptions={periodOptions} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {[...byUser.entries()].map(([email, entry]) => (
              <li key={email} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{entry.name}</p>
                  <Badge variant="neutral" className="font-normal">
                    {t("rowCount", { count: entry.rows.length })}
                  </Badge>
                </div>
                <ul className="mt-2 space-y-2">
                  {entry.rows.map((row) => (
                    <li key={row.id} className="rounded-md border border-border px-4 py-2">
                      <BalanceRowSummary row={row} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
