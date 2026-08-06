/**
 * Typed environment for the worker. Secrets are inherited from `apps/web/.env.local`
 * (loaded in `bootstrap.ts`) or the process environment.
 */

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  redisUrl: process.env.REDIS_URL?.trim() || "redis://localhost:6379",
  from: process.env.EMAIL_FROM?.trim() || "TimeOff <no-reply@timeoff.local>",
  replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
  companyTz: process.env.COMPANY_TZ?.trim() || "Europe/Berlin",
  auditRetentionDays: intEnv("AUDIT_RETENTION_DAYS", 3 * 365),
  emailMessageRetentionDays: intEnv("EMAIL_MESSAGE_RETENTION_DAYS", 90),
  maxEmailAttempts: intEnv("MAX_EMAIL_ATTEMPTS", 5),
  sweepIntervalMs: intEnv("OUTBOX_SWEEP_INTERVAL_MS", 300_000),
  sweepMinAgeMs: intEnv("OUTBOX_SWEEP_MIN_AGE_MS", 60_000),
  inFlightResetMs: intEnv("OUTBOX_INFLIGHT_RESET_MS", 5 * 60_000),
};
