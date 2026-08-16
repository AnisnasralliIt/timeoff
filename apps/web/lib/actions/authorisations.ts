"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import {
  createAuthorisationRequest,
  cancelAuthorisationRequest,
  decideAuthorisationRequest,
  updateAuthorisationPolicyForAdmin,
  adjustAuthorisationForAdmin,
} from "@/lib/services/authorisations";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";

export interface ActionState extends ServerErrorShape {
  ok?: boolean;
  requestId?: string;
  saved?: Awaited<ReturnType<typeof updateAuthorisationPolicyForAdmin>>;
}

const AUTHORISATION_PATHS = ["/authorisations", "/authorisations/new", "/dashboard", "/approvals"];

function revalidateAuthorisations() {
  for (const path of AUTHORISATION_PATHS) revalidatePath(path);
}

export async function updateAuthorisationPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    const updated = await updateAuthorisationPolicyForAdmin(user, {
      enabled: formData.get("enabled") === "on",
      monthlyAllowance: Number(formData.get("monthlyAllowance") ?? 4),
      minRequestHours: Number(formData.get("minRequestHours") ?? 2),
      maxRequestHours: Number(formData.get("maxRequestHours") ?? 4),
      requestIncrementHours: Number(formData.get("requestIncrementHours") ?? 2),
      carryOverEnabled: formData.get("carryOverEnabled") === "on",
      maxCarryOverHours: Number(formData.get("maxCarryOverHours") ?? 4),
      prorateFirstMonth: formData.get("prorateFirstMonth") === "on",
      requiresApproval: formData.get("requiresApproval") === "on",
    });
    revalidatePath("/admin/settings");
    revalidatePath("/admin/balances");
    revalidateAuthorisations();
    return { ok: true, saved: updated };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function createAuthorisationRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!date) return { errorCode: "authorisationInvalidDate" };
  try {
    const request = await createAuthorisationRequest(user, { date, startTime, endTime, reason });
    revalidateAuthorisations();
    return { ok: true, requestId: request.id };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function approveAuthorisationRequestAction(
  requestId: string,
  _prev: ActionState,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await decideAuthorisationRequest(user, requestId, { outcome: "APPROVED" });
    revalidateAuthorisations();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function rejectAuthorisationRequestAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const reason = String(formData.get("reason") ?? "");
  if (!reason.trim()) return { errorCode: "addReason" };
  try {
    await decideAuthorisationRequest(user, requestId, { outcome: "REJECTED", reason });
    revalidateAuthorisations();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function cancelAuthorisationRequestAction(
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const reason = String(formData.get("reason") ?? "");
  try {
    await cancelAuthorisationRequest(user, requestId, reason);
    revalidateAuthorisations();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function adjustAuthorisationBalanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await adjustAuthorisationForAdmin(user, {
      userId: String(formData.get("userId") ?? ""),
      period: String(formData.get("period") ?? "") || undefined,
      delta: Number(formData.get("delta") ?? 0),
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/admin/balances");
    revalidateAuthorisations();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}
