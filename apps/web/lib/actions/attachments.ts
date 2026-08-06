"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import {
  deleteAttachment,
  attachToRequest,
  AttachmentError,
} from "@/lib/services/attachments";
import { LeaveError } from "@/lib/services/leave";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";

export interface ActionState extends ServerErrorShape {
  ok?: boolean;
}

export async function deleteAttachmentAction(
  attachmentId: string,
  requestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await deleteAttachment(user, attachmentId);
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/requests");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (error) {
    if (error instanceof AttachmentError || error instanceof LeaveError) {
      return toErrorState(error);
    }
    throw error;
  }
}

export async function attachAttachmentAction(
  attachmentId: string,
  requestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await attachToRequest(user, attachmentId, requestId);
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/requests");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (error) {
    if (error instanceof AttachmentError || error instanceof LeaveError) {
      return toErrorState(error);
    }
    throw error;
  }
}
