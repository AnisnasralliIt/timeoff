"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import type { ServerErrorShape } from "@/lib/errors";

export type LoginState = ServerErrorShape;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { errorCode: "enterEmailAndPassword" };

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { errorCode: "invalidCredentials" };
    }
    throw error;
  }
}

export async function googleSignInAction(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
