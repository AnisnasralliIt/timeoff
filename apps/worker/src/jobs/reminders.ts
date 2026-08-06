/**
 * `leave.reminders` (daily): emails employees whose approved leave starts
 * tomorrow, plus their manager. Idempotent via the outbox `dedupeKey`
 * (`leave.starts:<emp|mgr>:<requestId>:<date>`), so re-running the job on the
 * same day never duplicates messages.
 */

import { prisma, type LeaveRequest } from "@timeoff/db";
import { addDaysISO } from "@timeoff/domain";
import { config } from "../config";
import { todayInTz } from "../tz";

export async function runLeaveReminders(): Promise<{
  tomorrow: string;
  requests: number;
  queued: number;
}> {
  const tomorrow = addDaysISO(todayInTz(config.companyTz), 1);

  const requests = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: tomorrow },
    include: {
      user: { include: { manager: true } },
      leaveType: true,
    },
  });

  const rows: Array<Record<string, unknown>> = [];
  for (const request of requests) {
    const span = request.startDate === request.endDate ? request.startDate : `${request.startDate} – ${request.endDate}`;
    rows.push({
      companyId: request.companyId,
      userId: request.userId,
      to: request.user.email,
      name: request.user.name,
      templateType: "leave.starts",
      dedupeKey: `leave.starts:emp:${request.id}:${tomorrow}`,
      data: {
        name: request.user.name,
        leaveType: request.leaveType.name,
        startDate: request.startDate,
        endDate: request.endDate,
        days: request.totalDays,
        span,
      },
    });
    const manager = request.user.manager;
    if (manager && manager.status === "ACTIVE") {
      rows.push({
        companyId: request.companyId,
        userId: manager.id,
        to: manager.email,
        name: manager.name,
        templateType: "leave.starts.team",
        dedupeKey: `leave.starts:mgr:${request.id}:${tomorrow}`,
        data: {
          employeeName: request.user.name,
          leaveType: request.leaveType.name,
          startDate: request.startDate,
          endDate: request.endDate,
          days: request.totalDays,
          span,
        },
      });
    }
  }

  const queued =
    rows.length > 0
      ? (
          await prisma.emailMessage.createMany({
            data: rows as never,
            skipDuplicates: true,
          })
        ).count
      : 0;

  return { tomorrow, requests: requests.length, queued };
}

export type ReminderRequest = LeaveRequest;
