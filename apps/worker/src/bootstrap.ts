/**
 * Entry point: load environment variables before anything imports the Prisma
 * client or BullMQ (both read env at import time), then start the worker.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

function monorepoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function loadEnv(): void {
  if (process.env.DATABASE_URL && process.env.REDIS_URL) return;
  const candidates = [
    resolve(monorepoRoot(), "apps/web/.env.local"),
    resolve(process.cwd(), ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    dotenv.config({ path, quiet: true });
    if (process.env.DATABASE_URL && process.env.REDIS_URL) break;
  }
}

loadEnv();
const { startWorker } = await import("./worker");
await startWorker();
