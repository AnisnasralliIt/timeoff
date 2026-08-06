/**
 * `outbox.sweep` (recurring): the crash-safe guarantee path for the
 * transactional outbox. It (1) resets rows stuck in SENDING (in-flight when a
 * worker died) back to QUEUED, and (2) re-enqueues `email.send` jobs for
 * QUEUED/FAILED rows that were never picked up. Web-side fast-path enqueues
 * may be missing after a crash between DB commit and Redis add — this sweep
 * closes that gap.
 */

import { prisma } from "@timeoff/db";
import { config } from "../config";
import { getEmailsQueue } from "../queue";

export async function runOutboxSweep(): Promise<{
  resetInFlight: number;
  enqueued: number;
}> {
  const inFlightReset = await prisma.emailMessage.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: new Date(Date.now() - config.inFlightResetMs) },
    },
    data: { status: "QUEUED", error: "reset by outbox sweep (in-flight timeout)" },
  });

  const stale = await prisma.emailMessage.findMany({
    where: {
      OR: [
        { status: "QUEUED", createdAt: { lt: new Date(Date.now() - config.sweepMinAgeMs) } },
        { status: "FAILED", attempts: { lt: config.maxEmailAttempts } },
      ],
    },
    select: { id: true },
    take: 200,
  });

  let enqueued = 0;
  if (stale.length > 0) {
    const queue = getEmailsQueue();
    for (const message of stale) {
      await queue.add("email.send", { messageId: message.id }, { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
      enqueued += 1;
    }
  }

  return { resetInFlight: inFlightReset.count, enqueued };
}
