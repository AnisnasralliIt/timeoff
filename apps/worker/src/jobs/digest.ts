/**
 * `digest.pending` (weekly, Mondays): emails each manager a summary of leave
 * requests from their direct reports that are waiting for approval, and each
 * HR/SUPER_ADMIN user a company-wide summary. Idempotent per recipient +
 * week via `digest.pending:<companyId>:<userId>:<monday>`.
 */

import { prisma } from "@timeoff/db";
import { config } from "../config";
import { mondayOfWeek } from "../tz";

export async function runPendingDigest(): Promise<{ weekStart: string; recipients: number; queued: number }> {
  const weekStart = mondayOfWeek(config.companyTz);
  const companies = await prisma.company.findMany({ select: { id: true } });

  let recipients = 0;
  let queued = 0;

  for (const company of companies) {
    const pending = await prisma.leaveRequest.findMany({
      where: { companyId: company.id, status: "PENDING" },
      include: { user: { include: { manager: true } }, leaveType: true },
      orderBy: { createdAt: "asc" },
    });

    const byManager = new Map<string, typeof pending>();
    const hrOversight = pending;
    for (const request of pending) {
      const managerId = request.user.managerId;
      if (!managerId) continue;
      const list = byManager.get(managerId) ?? [];
      list.push(request);
      byManager.set(managerId, list);
    }

    const overseers = await prisma.user.findMany({
      where: { companyId: company.id, status: "ACTIVE", role: { in: ["HR", "ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, name: true, email: true },
    });

    const rows: Array<Record<string, unknown>> = [];
    const push = (userId: string | null, to: string, name: string, items: typeof pending, scope: string) => {
      if (items.length === 0) return;
      recipients += 1;
      rows.push({
        companyId: company.id,
        userId,
        to,
        name,
        templateType: "digest.pending",
        dedupeKey: `digest.pending:${company.id}:${scope}:${weekStart}`,
        data: {
          pendingCount: items.length,
          items: items.slice(0, 15).map((r) => ({
            requesterName: r.user.name,
            leaveType: r.leaveType.name,
            startDate: r.startDate,
            endDate: r.endDate,
            days: r.totalDays,
            requestId: r.id,
          })),
        },
      });
    };

    for (const [managerId, list] of byManager) {
      const manager = list[0]?.user.manager;
      push(managerId, manager?.email ?? `${managerId}@invalid`, manager?.name ?? managerId, list, managerId);
    }
    for (const overseer of overseers) {
      push(overseer.id, overseer.email, overseer.name, hrOversight, `hr:${overseer.id}`);
    }

    if (rows.length > 0) {
      const created = await prisma.emailMessage.createMany({ data: rows as never, skipDuplicates: true });
      queued += created.count;
    }
  }

  return { weekStart, recipients, queued };
}
