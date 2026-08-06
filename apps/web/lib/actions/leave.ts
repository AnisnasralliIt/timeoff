"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import {
  createLeaveRequest,
  cancelLeaveRequest,
  decideLeaveRequest,
  createDelegation,
  deactivateDelegation,
} from "@/lib/services/leave";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";

export interface CreateRequestState extends ServerErrorShape {
  requestId?: string;
}

export interface ActionState extends ServerErrorShape {
  ok?: boolean;
}

export async function createLeaveRequestAction(
  _prev: CreateRequestState,
  formData: FormData,
): Promise<CreateRequestState> {
  const user = await requireAuth();

  const leaveTypeId = String(formData.get("leaveTypeId") ?? "");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const startDayPart = String(formData.get("startDayPart") ?? "FULL");
  const endDayPart = String(formData.get("endDayPart") ?? "FULL");
  const reason = String(formData.get("reason") ?? "");
  const attachmentId = String(formData.get("attachmentId") ?? "");

  if (!leaveTypeId || !startDate || !endDate) {
    return { errorCode: "chooseLeaveTypeAndRange" };
  }

  try {
    const request = await createLeaveRequest(user, {
      leaveTypeId,
      startDate,
      endDate,
      startDayPart: startDayPart as "FULL" | "FIRST_HALF" | "SECOND_HALF",
      endDayPart: endDayPart as "FULL" | "FIRST_HALF" | "SECOND_HALF",
      reason,
      attachmentIds: attachmentId ? [attachmentId] : [],
    });
    revalidatePath("/requests");
    revalidatePath("/dashboard");
    return { requestId: request.id };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelLeaveRequestAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const reason = String(formData.get("reason") ?? "");
  try {
    await cancelLeaveRequest(user, requestId, reason);
    revalidatePath("/requests");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function approveLeaveRequestAction(
  requestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await decideLeaveRequest(user, requestId, { outcome: "APPROVED" });
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function rejectLeaveRequestAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const reason = String(formData.get("reason") ?? "");
  if (!reason.trim()) return { errorCode: "addReason" };
  try {
    await decideLeaveRequest(user, requestId, { outcome: "REJECTED", reason });
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function createDelegationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const delegateId = String(formData.get("delegateId") ?? "");
  const startsOn = String(formData.get("startsOn") ?? "").trim();
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  if (!delegateId) return { errorCode: "chooseDelegate" };
  try {
    await createDelegation(user, {
      delegateId,
      startsOn: startsOn || undefined,
      endsOn: endsOn || undefined,
    });
    revalidatePath("/approvals");
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function deactivateDelegationAction(
  delegationId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await deactivateDelegation(user, delegationId);
    revalidatePath("/approvals");
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}
