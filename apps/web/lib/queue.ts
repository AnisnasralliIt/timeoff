/**
 * Fast-path queue: after the outbox rows are committed, push `email.send`
 * jobs to Redis so the worker sends them without waiting for the sweep. Never
 * throws to the caller — the recurring outbox sweep is the guarantee path.
 */

import { Queue } from "bullmq";

let queue: Queue | null = null;

function emailsQueue(): Queue {
  if (!queue) {
    const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
    queue = new Queue("emails", {
      connection: {
        host: url.hostname || "localhost",
        port: url.port ? Number(url.port) : 6379,
        username: url.username || undefined,
        password: url.password || undefined,
        db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      },
    });
  }
  return queue;
}

export async function enqueueEmails(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  try {
    const q = emailsQueue();
    await q.addBulk(
      messageIds.map((messageId) => ({
        name: "email.send",
        data: { messageId },
        opts: { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 },
      })),
    );
  } catch (error) {
    console.error("[web] email fast-path enqueue failed (outbox sweep will pick it up):", error);
  }
}
