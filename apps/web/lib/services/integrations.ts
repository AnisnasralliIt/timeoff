/**
 * Private per-user iCal feed (I2). Each user gets a feed token (AES-GCM
 * encrypted in the `Integration` table) that calendar apps can subscribe to
 * anonymously — the feed exposes only that user's approved leave as all-day
 * events.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@timeoff/db";
import { addDaysISO } from "@timeoff/domain";
import type { SessionUser } from "@/lib/session";
import { encryptString, decryptString } from "@/lib/crypto";
import { audit } from "@/lib/services/leave";

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

/** The raw feed token for `user` (creating one on first use). */
export async function getFeedToken(user: SessionUser): Promise<string> {
  const existing = await prisma.integration.findUnique({
    where: { companyId_userId_kind: { companyId: user.companyId!, userId: user.id, kind: "ICAL" } },
  });
  if (existing?.tokenEncrypted) {
    try {
      return decryptString(existing.tokenEncrypted);
    } catch {
      // key rotation or corruption — fall through and regenerate
    }
  }
  return createFeedToken(user);
}

/** Creates a fresh token and returns it (rotating any previous one). */
export async function createFeedToken(user: SessionUser): Promise<string> {
  const token = newToken();
  const encrypted = encryptString(token);
  const row = await prisma.integration.upsert({
    where: { companyId_userId_kind: { companyId: user.companyId!, userId: user.id, kind: "ICAL" } },
    create: {
      companyId: user.companyId!,
      userId: user.id,
      kind: "ICAL",
      tokenEncrypted: encrypted,
      lastSyncedAt: new Date(),
    },
    update: { tokenEncrypted: encrypted, lastSyncedAt: new Date() },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "integration.ical.rotate",
    entityType: "Integration",
    entityId: row.id,
    after: { kind: "ICAL" },
  });
  return token;
}

/** True when `token` matches the stored token for `userId` (constant-time). */
export async function verifyFeedToken(userId: string, token: string): Promise<boolean> {
  const row = await prisma.integration.findFirst({
    where: { userId, kind: "ICAL", enabled: true },
  });
  if (!row?.tokenEncrypted) return false;
  let stored: string;
  try {
    stored = decryptString(row.tokenEncrypted);
  } catch {
    return false;
  }
  if (stored.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) {
    diff |= stored.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

interface FeedRequest {
  id: string;
  startDate: string;
  endDate: string;
  startDayPart: string;
  endDayPart: string;
  leaveType: { name: string };
}

/** The user's approved leave, newest of the relevant span first. */
export async function getApprovedRequestsForFeed(userId: string): Promise<FeedRequest[]> {
  return prisma.leaveRequest.findMany({
    where: { userId, status: "APPROVED" },
    include: { leaveType: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
}

function partSuffix(part: string): string {
  if (part === "FIRST_HALF") return " (AM)";
  if (part === "SECOND_HALF") return " (PM)";
  return "";
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatDateStamped(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function dateValue(iso: string): string {
  return iso.replaceAll("-", "");
}

/** Builds an RFC 5545 feed of all-day leave events for a user. */
export function buildIcs(requests: FeedRequest[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TimeOff//Leave Feed//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:TimeOff leave",
    formatDateStamped() !== "" ? "X-WR-TIMEZONE:Europe/Berlin" : "X-WR-TIMEZONE:Europe/Berlin",
  ];
  for (const request of requests) {
    const summary =
      request.leaveType.name +
      partSuffix(request.startDayPart) +
      (request.endDate !== request.startDate ? partSuffix(request.endDayPart) : "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:leave-${request.id}@timeoff`,
      `DTSTAMP:${formatDateStamped()}`,
      `DTSTART;VALUE=DATE:${dateValue(request.startDate)}`,
      `DTEND;VALUE=DATE:${dateValue(addDaysISO(request.endDate, 1))}`,
      `SUMMARY:${escapeIcs(summary)}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
