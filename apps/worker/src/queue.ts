/**
 * Shared BullMQ queue + connection plumbing (A5). The web app enqueues
 * `email.send` jobs as the fast path after committing outbox rows; the
 * recurring `outbox.sweep` on the scheduled queue is the guarantee path.
 */

import { Queue } from "bullmq";
import { config } from "./config";

export type RedisConnectionOptions = {
  host: string;
  port: number;
  password?: string;
  db?: number;
  username?: string;
};

export function redisConnection(): RedisConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname || "localhost",
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
  };
}

let emailsQueue: Queue | null = null;
let scheduledQueue: Queue | null = null;

export function getEmailsQueue(): Queue {
  if (!emailsQueue) emailsQueue = new Queue("emails", { connection: redisConnection() });
  return emailsQueue;
}

export function getScheduledQueue(): Queue {
  if (!scheduledQueue) scheduledQueue = new Queue("scheduled", { connection: redisConnection() });
  return scheduledQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailsQueue?.close().catch(() => undefined),
    scheduledQueue?.close().catch(() => undefined),
  ]);
  emailsQueue = null;
  scheduledQueue = null;
}
