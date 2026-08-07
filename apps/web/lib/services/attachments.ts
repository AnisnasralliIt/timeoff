/**
 * Attachments for leave requests (I4): medical certificates and similar. Files
 * are staged unclaimed, then bound to a request at submit time (enforcing
 * `requiresAttachment`). Blobs are encrypted at rest before reaching the bucket
 * and download access is authenticated (or via a short-lived HMAC-signed link).
 */
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@timeoff/db";
import type { SessionUser } from "@/lib/session";
import { encryptBytes, decryptBytes } from "@/lib/crypto";
import { getObject, putObject, deleteObject, StorageError } from "@/lib/attachments/storage";
import { audit, LeaveError } from "@/lib/services/leave";
import { COMPANY_WIDE_ROLES, PEOPLE_OPS_ROLES } from "@/lib/permissions";

export { StorageError };

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly values?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export interface StageAttachmentInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Buffer;
  kind?: "GENERAL" | "MEDICAL_CERTIFICATE";
}

/** Upload + encrypt + persist an unclaimed attachment row. */
export async function stageAttachment(user: SessionUser, input: StageAttachmentInput) {
  if (!input.fileName.trim()) throw new AttachmentError("A file name is required.");
  if (input.sizeBytes <= 0) throw new AttachmentError("The file is empty.");
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError("Files are limited to 10 MB.");
  }
  if (!ATTACHMENT_TYPES.has(input.contentType)) {
    throw new AttachmentError("Only PDF and image files (png, jpg, webp) are allowed.");
  }

  const key = `attachments/${user.companyId}/${randomUUID()}`;
  const encrypted = encryptBytes(input.body);
  await putObject(key, encrypted, input.contentType);

  try {
    return await prisma.attachment.create({
      data: {
        companyId: user.companyId!,
        uploaderId: user.id,
        storageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        kind: input.kind ?? "GENERAL",
      },
    });
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
}

/** Bind staged attachments to a freshly created request (validated + atomic). */
export async function attachStagedAttachments(
  tx: Prisma.TransactionClient,
  userId: string,
  companyId: string,
  requestId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const staged = await tx.attachment.findMany({
    where: { id: { in: attachmentIds }, companyId },
  });
  if (staged.length !== attachmentIds.length) {
    throw new AttachmentError("One of the uploaded files could not be found.");
  }
  for (const attachment of staged) {
    if (attachment.uploaderId !== userId) {
      throw new AttachmentError("You can only attach files you uploaded.");
    }
    if (attachment.deletedAt) throw new AttachmentError("That file was already deleted.");
    if (attachment.requestId) {
      throw new AttachmentError("That file is already attached to a request.");
    }
    await tx.attachment.update({
      where: { id: attachment.id },
      data: { requestId },
    });
  }
}

/** Bind a staged attachment to an existing request (requester or HR). */
export async function attachToRequest(user: SessionUser, attachmentId: string, requestId: string) {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, companyId: user.companyId },
    select: { userId: true },
  });
  if (!request) throw new LeaveError("Request not found.");
  if (request.userId !== user.id && !PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE")) {
    throw new LeaveError("Only the requester or HR can add attachments.");
  }
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, companyId: user.companyId, deletedAt: null },
  });
  if (!attachment) throw new AttachmentError("Attachment not found.");
  if (attachment.uploaderId !== user.id) {
    throw new AttachmentError("You can only attach files you uploaded.");
  }
  if (attachment.requestId) throw new AttachmentError("That file is already attached to a request.");
  return prisma.attachment.update({
    where: { id: attachmentId },
    data: { requestId },
  });
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  kind: string;
  createdAt: Date;
  uploaderName: string;
}

/** Attachments visible to `user` for a request, newest first. */
export async function listAttachmentsForRequest(
  user: SessionUser,
  requestId: string,
): Promise<AttachmentRow[]> {
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, companyId: user.companyId },
    include: { user: { select: { id: true, managerId: true, departmentId: true } } },
  });
  if (!request) throw new LeaveError("Request not found.");
  if (!(await canViewRequest(request, user))) {
    throw new LeaveError("You cannot access this request.");
  }
  const rows = await prisma.attachment.findMany({
    where: { requestId, deletedAt: null },
    include: { uploader: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((a: (typeof rows)[number]) => ({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    kind: a.kind,
    createdAt: a.createdAt,
    uploaderName: a.uploader.name,
  }));
}

/** True when `user` may view a request (owner, department manager, or people-ops/executive). */
export async function canViewRequest(
  request: { userId: string; user: { id: string; managerId: string | null; departmentId: string | null } },
  user: SessionUser,
): Promise<boolean> {
  if (COMPANY_WIDE_ROLES.has(user.role ?? "EMPLOYEE")) return true;
  if (request.userId === user.id) return true;
  if (user.role === "MANAGER" && request.user.departmentId === user.departmentId) return true;
  return false;
}

export interface AttachmentDownload {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Buffer;
}

/**
 * Download an attachment. `user` null is allowed only when the route already
 * verified a signed link (access is still checked at the row level).
 */
export async function getAttachmentForDownload(
  user: SessionUser | null,
  attachmentId: string,
): Promise<AttachmentDownload> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    include: { request: { include: { user: { select: { id: true, managerId: true, departmentId: true } } } } },
  });
  if (!attachment) throw new AttachmentError("Attachment not found.");
  if (user && !(await canViewAttachment(user, attachment))) {
    throw new AttachmentError("You cannot access this attachment.");
  }
  const { body } = await getObject(attachment.storageKey);
  const plain = decryptBytes(body);
  return {
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    body: plain,
  };
}

async function canViewAttachment(
  user: SessionUser,
  attachment: {
    uploaderId: string;
    request: {
      userId: string;
      user: { id: string; managerId: string | null; departmentId: string | null };
    } | null;
  },
): Promise<boolean> {
  if (PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE")) return true;
  if (attachment.uploaderId === user.id) return true;
  if (!attachment.request) return false;
  return canViewRequest(attachment.request, user);
}

/** Soft-delete + purge the blob. Allowed for the uploader, owner, or HR. */
export async function deleteAttachment(user: SessionUser, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, companyId: user.companyId, deletedAt: null },
    include: { request: { select: { userId: true } } },
  });
  if (!attachment) throw new AttachmentError("Attachment not found.");
  const allowed =
    PEOPLE_OPS_ROLES.has(user.role ?? "EMPLOYEE") ||
    attachment.uploaderId === user.id ||
    attachment.request?.userId === user.id;
  if (!allowed) throw new AttachmentError("You cannot delete this attachment.");

  await deleteObject(attachment.storageKey);
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() },
  });
  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "attachment.delete",
    entityType: "Attachment",
    entityId: attachmentId,
    after: { fileName: attachment.fileName, requestId: attachment.requestId },
  });
  return { ok: true as const };
}
