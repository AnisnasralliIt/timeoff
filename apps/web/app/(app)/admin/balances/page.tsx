import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/session";
import { prisma } from "@timeoff/db";
import { balanceIssueRows, listBalancesForAdmin } from "@/lib/services/admin";
import { balanceHistoryFor, LeaveError } from "@/lib/services/leave";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@timeoff/ui";
import { BalanceAdjustDialog, BalanceRowSummary } from "@/components/admin/balance-adjust-form";
import { BalanceHistoryPicker } from "@/components/admin/balance-history-picker";
import { BalanceHistory } from "@/components/balance-history";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("adminBalances") };
}

export default async function AdminBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; type?: string; issue?: string }>;
}) {
  const user = await requireRole(["HR", "ADMIN"]);
  const params = await searchParams;
  const t = await getTranslations("adminBalances");
  const tAdmin = await getTranslations("admin");
  const tHistory = await getTranslations("balanceHistory");

  const [users, leaveTypes] = await Promise.all([
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
  ]);

  const issueActive = params.issue === "balance";
  const issueRows = issueActive ? await balanceIssueRows(user) : [];
  const issueByBalanceId = new Map<string, string[]>();
  for (const r of issueRows) {
    const list = issueByBalanceId.get(r.balanceId ?? "") ?? [];
    list.push(r.reason);
    issueByBalanceId.set(r.balanceId ?? "", list);
  }
  const issueUserIds = new Set(issueRows.map((r) => r.userId));
  const effectiveUserId = params.user ?? (issueActive && issueUserIds.size === 1 ? [...issueUserIds][0] : undefined);

  const [rows, history, historyLimit, selectedName] = await Promise.all([
    listBalancesForAdmin(user, { userId: effectiveUserId, leaveTypeId: params.type }),
    effectiveUserId
      ? balanceHistoryFor(user, effectiveUserId).catch((error) =>
          error instanceof LeaveError ? ([] as Awaited<ReturnType<typeof balanceHistoryFor>>) : Promise.reject(error),
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof balanceHistoryFor>>),
    (async () => {
      const vacation = await prisma.leaveType.findFirst({ where: { companyId: user.companyId, name: "Vacation" } });
      if (!vacation) return null;
      const policy = await prisma.leavePolicy.findFirst({
        where: { companyId: user.companyId, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
        select: { carryOverDays: true },
      });
      return policy?.carryOverDays ?? null;
    })(),
    effectiveUserId
      ? prisma.user.findUnique({ where: { id: effectiveUserId }, select: { name: true } }).then((r) => r?.name ?? null)
      : Promise.resolve(null),
  ]);

  const visibleRows = issueActive ? rows.filter((row) => issueByBalanceId.has(row.id)) : rows;

  const periodStarts = await prisma.leaveBalance.findMany({
    where: { companyId: user.companyId },
    select: { periodStart: true },
    distinct: ["periodStart"],
    orderBy: { periodStart: "desc" },
  });
  const periodOptions = periodStarts.map((p: (typeof periodStarts)[number]) => ({
    start: p.periodStart,
    label: t("leaveYearOption", { year: p.periodStart.slice(0, 4) }),
  }));

  const byUser = new Map<string, { name: string; email: string; rows: (typeof visibleRows)[number][] }>();
  for (const row of visibleRows) {
    const key = row.userEmail;
    if (!byUser.has(key)) byUser.set(key, { name: row.userName, email: row.userEmail, rows: [] });
    byUser.get(key)!.rows.push(row);
  }

  const negative = issueRows.filter((r) => r.reason === "negative").length;
  const inconsistent = issueRows.filter((r) => r.reason === "inconsistent").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <BalanceHistoryPicker users={users} value={effectiveUserId} />
          <p className="text-sm text-muted-foreground">
            {t("count", { count: visibleRows.length, selected: effectiveUserId ? "true" : "false" })}
          </p>
        </div>
        <BalanceAdjustDialog users={users} leaveTypes={leaveTypes} periodOptions={periodOptions} />
      </div>
      {issueActive ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive-border bg-destructive-subtle px-4 py-3">
          <div className="flex items-center gap-3 text-destructive-subtle-foreground">
            <Badge variant="danger">{tAdmin("attentionBalanceIssues")}</Badge>
            <p className="text-sm">
              {tAdmin("attentionBalanceBreakdown", { negative, inconsistent })}
              {" · "}
              {t("affectedEmployees", { count: issueUserIds.size })}
            </p>
          </div>
          <Link href="/admin/balances" className="text-xs underline underline-offset-2 hover:text-foreground">
            {t("showAllBalances")}
          </Link>
        </div>
      ) : null}
      {effectiveUserId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tHistory("title")}</CardTitle>
            {selectedName ? <CardDescription>{selectedName}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <BalanceHistory years={history} carryOverLimit={historyLimit} />
          </CardContent>
        </Card>
      ) : null}
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
                  {entry.rows.map((row: (typeof visibleRows)[number]) => {
                    const reasons = issueByBalanceId.get(row.id);
                    return (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-2"
                      >
                        <BalanceRowSummary row={row} />
                        {reasons ? (
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            {reasons.map((reason: string) => (
                              <Badge key={reason} variant="danger" className="font-normal">
                                {tAdmin(`balanceReason.${reason}`)}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
