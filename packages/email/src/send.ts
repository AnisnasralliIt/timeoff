/**
 * Delivery layer. Uses the Resend SDK when `RESEND_API_KEY` is set; otherwise
 * runs in a documented dev mode (returns `delivered: false`) so the outbox
 * pipeline is testable end-to-end without a real provider.
 */

import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult = { delivered: boolean; reason?: string };

let cachedClient: Resend | null = null;
let cachedKey: string | undefined;

function client(): { resend: Resend | null; reason?: string } {
  const key = process.env.RESEND_API_KEY?.trim();
  if (key === cachedKey && cachedClient) return { resend: cachedClient };
  cachedKey = key;
  cachedClient = key ? new Resend(key) : null;
  return cachedClient ? { resend: cachedClient } : { resend: null, reason: "RESEND_API_KEY not set (dev mode)" };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { resend, reason } = client();
  if (!resend) return { delivered: false, reason };
  const result = await resend.emails.send({
    from: input.from,
    to: [input.to],
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (result.error) {
    return { delivered: false, reason: result.error.message ?? "Resend returned an error" };
  }
  return { delivered: true };
}
