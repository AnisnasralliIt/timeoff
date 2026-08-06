/**
 * `audit.purge` (daily, G3): deletes `AuditLog` rows older than
 * `AUDIT_RETENTION_DAYS` (default 3 years) and `EmailMessage` rows older than
 * `EMAIL_MESSAGE_RETENTION_DAYS` (default 90 days). Idempotent.
 */

import { prisma } from "@timeoff/db";
import { config } from "../config";

export async function runAuditPurge(): Promise<{ auditDeleted: number; emailMessagesDeleted: number }> {
  const auditCutoff = new Date(Date.now() - config.auditRetentionDays * 86_400_000);
  const emailCutoff = new Date(Date.now() - config.emailMessageRetentionDays * 86_400_000);

  const [auditDeleted, emailMessagesDeleted] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    prisma.emailMessage.deleteMany({ where: { createdAt: { lt: emailCutoff } } }),
  ]);

  return { auditDeleted: auditDeleted.count, emailMessagesDeleted: emailMessagesDeleted.count };
}
