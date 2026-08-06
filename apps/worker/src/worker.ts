/**
 * Stage 6 worker (A5): BullMQ workers over Redis, running the email outbox,
 * daily leave-start reminders, the weekly manager digest, the audit-log
 * retention purge (G3), and the crash-safe outbox sweep.
 */

import { prisma } from "@timeoff/db";
import { Worker, type Job } from "bullmq";
import { config } from "./config";
import { redisConnection, getEmailsQueue, getScheduledQueue, closeQueues } from "./queue";
import { processEmailMessage } from "./jobs/send-email";
import { runLeaveReminders } from "./jobs/reminders";
import { runPendingDigest } from "./jobs/digest";
import { runAuditPurge } from "./jobs/purge";
import { runOutboxSweep } from "./jobs/sweep";

async function scheduledProcessor(job: Job): Promise<unknown> {
  switch (job.name) {
    case "leave.reminders":
      return runLeaveReminders();
    case "digest.pending":
      return runPendingDigest();
    case "audit.purge":
      return runAuditPurge();
    case "outbox.sweep":
      return runOutboxSweep();
    default:
      throw new Error(`Unknown scheduled job: ${job.name}`);
  }
}

export async function registerSchedulers(): Promise<void> {
  const scheduled = getScheduledQueue();
  const tz = config.companyTz;
  await scheduled.upsertJobScheduler(
    "leave-reminders",
    { pattern: "0 6 * * *", tz },
    { name: "leave.reminders", data: {} },
  );
  await scheduled.upsertJobScheduler(
    "manager-digest",
    { pattern: "0 8 * * 1", tz },
    { name: "digest.pending", data: {} },
  );
  await scheduled.upsertJobScheduler(
    "audit-purge",
    { pattern: "0 3 * * *", tz },
    { name: "audit.purge", data: {} },
  );
  await scheduled.upsertJobScheduler(
    "outbox-sweep",
    { every: config.sweepIntervalMs },
    { name: "outbox.sweep", data: {} },
  );
}

let stopped = false;

export async function startWorker(): Promise<void> {
  await registerSchedulers();

  const emailsWorker = new Worker("emails", async (job) => processEmailMessage(job.data.messageId as string), {
    connection: redisConnection(),
    concurrency: 5,
  });
  const scheduledWorker = new Worker("scheduled", scheduledProcessor, {
    connection: redisConnection(),
    concurrency: 1,
  });

  emailsWorker.on("failed", (job, err) => {
    console.error(`[worker] email.send failed (${job?.data.messageId}):`, err.message);
  });
  scheduledWorker.on("failed", (job, err) => {
    console.error(`[worker] scheduled job ${job?.name} failed:`, err.message);
  });

  const shutdown = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    console.log(`[worker] ${signal} received, shutting down…`);
    await Promise.allSettled([
      emailsWorker.close(),
      scheduledWorker.close(),
      closeQueues(),
      prisma.$disconnect(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("[worker] listening — emails + scheduled queues (Redis on " + config.redisUrl + ")");
}
