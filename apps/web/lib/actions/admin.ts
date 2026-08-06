"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import {
  createUserForAdmin,
  updateUserForAdmin,
  createDepartmentForAdmin,
  renameDepartmentForAdmin,
  createLeaveTypeForAdmin,
  updatePolicyForAdmin,
  adjustBalanceForAdmin,
} from "@/lib/services/admin";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";

export interface ActionState extends ServerErrorShape {
  ok?: boolean;
}

const ADMIN_PATHS = ["/admin", "/admin/users", "/admin/departments", "/admin/leave-types", "/admin/balances"];

function revalidateAdmin() {
  for (const path of ADMIN_PATHS) revalidatePath(path);
}

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAuth();
  const departmentId = String(formData.get("departmentId") ?? "");
  const managerId = String(formData.get("managerId") ?? "");
  try {
    await createUserForAdmin(user, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "EMPLOYEE") as
        | "EMPLOYEE"
        | "MANAGER"
        | "HR"
        | "ADMIN"
        | "EXECUTIVE",
      password: String(formData.get("password") ?? ""),
      departmentId,
      managerId: managerId || undefined,
      employmentType: String(formData.get("employmentType") ?? "FULL_TIME"),
      employmentStartDate: String(formData.get("employmentStartDate") ?? ""),
      title: String(formData.get("title") ?? ""),
    });
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function updateUserAction(
  userId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await updateUserForAdmin(user, userId, {
      role: (String(formData.get("role") ?? "") as
        | "EMPLOYEE"
        | "MANAGER"
        | "HR"
        | "ADMIN"
        | "EXECUTIVE"
        | "SUPER_ADMIN") || undefined,
      status: (String(formData.get("status") ?? "") as "ACTIVE" | "INACTIVE" | "OFFBOARDED") || undefined,
      departmentId: String(formData.get("departmentId") ?? "") || undefined,
      managerId: String(formData.get("managerId") ?? ""),
      employmentType: String(formData.get("employmentType") ?? "") || undefined,
      title: String(formData.get("title") ?? ""),
    });
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function createDepartmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await createDepartmentForAdmin(
      user,
      String(formData.get("name") ?? ""),
      String(formData.get("code") ?? ""),
    );
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function renameDepartmentAction(
  departmentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await renameDepartmentForAdmin(user, departmentId, String(formData.get("name") ?? ""));
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function createLeaveTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await createLeaveTypeForAdmin(user, {
      name: String(formData.get("name") ?? ""),
      color: String(formData.get("color") ?? "#2e9486"),
      requiresApproval: formData.get("requiresApproval") === "on",
      requiresAttachment: formData.get("requiresAttachment") === "on",
      isPaid: formData.get("isPaid") === "on",
      annualAllotment: Number(formData.get("annualAllotment") ?? 0),
      carryOverDays: Number(formData.get("carryOverDays") ?? 0),
      negativeAllowed: formData.get("negativeAllowed") === "on",
      probationDays: Number(formData.get("probationDays") ?? 0),
    });
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function updatePolicyAction(
  policyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAuth();
  const carryOverExpiresOn = String(formData.get("carryOverExpiresOn") ?? "");
  try {
    await updatePolicyForAdmin(user, policyId, {
      annualAllotment: Number(formData.get("annualAllotment") ?? 0),
      carryOverDays: Number(formData.get("carryOverDays") ?? 0),
      carryOverExpiresOn: carryOverExpiresOn || null,
      negativeAllowed: formData.get("negativeAllowed") === "on",
      probationDays: Number(formData.get("probationDays") ?? 0),
      requiresApproval: formData.get("requiresApprovalOverride") === "on" ? formData.get("requiresApproval") === "on" : null,
      requiresAttachment: formData.get("requiresAttachmentOverride") === "on" ? formData.get("requiresAttachment") === "on" : null,
      maxBalance: null,
    });
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}

export async function adjustBalanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAuth();
  try {
    await adjustBalanceForAdmin(user, {
      userId: String(formData.get("userId") ?? ""),
      leaveTypeId: String(formData.get("leaveTypeId") ?? ""),
      delta: Number(formData.get("delta") ?? 0),
      reason: String(formData.get("reason") ?? ""),
      periodStart: String(formData.get("periodStart") ?? "") || undefined,
    });
    revalidateAdmin();
    return { ok: true };
  } catch (error) {
    return toErrorState(error);
  }
}
