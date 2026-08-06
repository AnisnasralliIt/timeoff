/**
 * `email.send` processor: claims an `EmailMessage` row (QUEUED → SENDING),
 * renders it via `@timeoff/email`, delivers it, and records the outcome.
 * Idempotent: a claimed message is never sent twice by concurrent workers.
 */

import { prisma } from "@timeoff/db";
import { renderEmail, sendEmail, type EmailTemplate } from "@timeoff/email";
import { config } from "../config";

export async function processEmailMessage(messageId: string): Promise<string> {
  const message = await prisma.emailMessage.findUnique({ where: { id: messageId } });
  if (!message) return "missing";
  if (message.status !== "QUEUED") return `skipped (${message.status})`;

  const claimed = await prisma.emailMessage.updateMany({
    where: { id: messageId, status: "QUEUED" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "concurrent-claim-skipped";

  const company = await prisma.company.findUnique({ where: { id: message.companyId } });
  const template = message.templateType as EmailTemplate;
  const attempts = (message.attempts ?? 0) + 1;

  let rendered: ReturnType<typeof renderEmail> | undefined;
  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    rendered = renderEmail(template, message.data as never, {
      companyName: company?.name,
    });
    result = await sendEmail({
      to: message.to,
      from: config.from,
      replyTo: config.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (error) {
    result = { delivered: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (result.delivered) {
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: { status: "SENT", sentAt: new Date(), subject: rendered!.subject, html: rendered!.html, text: rendered!.text, error: null },
    });
    return "sent";
  }

  const devMode = result.reason?.includes("dev mode");
  if (devMode) {
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: { status: "SENT", sentAt: new Date(), subject: rendered!.subject, html: rendered!.html, text: rendered!.text, error: result.reason },
    });
    return "sent-dev-mode";
  }

  if (attempts >= config.maxEmailAttempts) {
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: { status: "FAILED", error: result.reason ?? "unknown error", html: rendered?.html, text: rendered?.text },
    });
    return "failed";
  }
  await prisma.emailMessage.update({
    where: { id: messageId },
    data: { status: "QUEUED", error: result.reason ?? "unknown error" },
  });
  return "queued-for-retry";
}
