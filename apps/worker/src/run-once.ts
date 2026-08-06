/**
 * One-shot runner for smoke tests and manual runs. Invokes a single handler
 * and exits without starting BullMQ workers or registering schedulers:
 *
 *   pnpm --filter @timeoff/worker once leave.reminders
 *   pnpm --filter @timeoff/worker once digest.pending
 *   pnpm --filter @timeoff/worker once audit.purge
 *   pnpm --filter @timeoff/worker once outbox.sweep
 *   pnpm --filter @timeoff/worker once send <messageId>
 */

import { prisma } from "@timeoff/db";
import { runLeaveReminders } from "./jobs/reminders";
import { runPendingDigest } from "./jobs/digest";
import { runAuditPurge } from "./jobs/purge";
import { runOutboxSweep } from "./jobs/sweep";
import { processEmailMessage } from "./jobs/send-email";
import { closeQueues } from "./queue";

const [, , name, arg] = process.argv;

const result = await (async () => {
  switch (name) {
    case "leave.reminders":
      return runLeaveReminders();
    case "digest.pending":
      return runPendingDigest();
    case "audit.purge":
      return runAuditPurge();
    case "outbox.sweep":
      return runOutboxSweep();
    case "send":
      if (!arg) throw new Error("send requires a messageId");
      return processEmailMessage(arg);
    default:
      throw new Error(`Unknown handler: ${name}`);
  }
})();

console.log(JSON.stringify(result, null, 2));
await closeQueues();
await prisma.$disconnect();
