/**
 * Transactional outbox writer (I3): creates an `EmailMessage` row inside the
 * same Prisma transaction that writes the in-app `Notification`, so an email
 * intent is never lost if the process dies between commit and enqueue. The
 * worker drains these rows (fast path: BullMQ job; guarantee: outbox sweep).
 */

import { Prisma } from "@timeoff/db";
import type { EmailTemplate, TemplateData } from "@timeoff/email";

type Db = Prisma.TransactionClient;

export interface EnqueueOutboxInput<T extends EmailTemplate> {
  companyId: string;
  userId: string;
  templateType: T;
  data: TemplateData[T];
  dedupeKey?: string;
}

/**
 * Creates an outbox row for `userId`'s email. Returns the message id (or null
 * if the recipient has no email). Use inside a transaction.
 */
export async function enqueueOutbox<T extends EmailTemplate>(
  tx: Db,
  input: EnqueueOutboxInput<T>,
): Promise<string | null> {
  const recipient = await tx.user.findUnique({
    where: { id: input.userId },
    select: { email: true, name: true },
  });
  if (!recipient?.email) return null;
  const message = await tx.emailMessage.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      to: recipient.email,
      name: recipient.name,
      templateType: input.templateType,
      data: input.data as object,
      dedupeKey: input.dedupeKey,
    },
  });
  return message.id;
}
