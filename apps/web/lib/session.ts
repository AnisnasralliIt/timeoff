import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Role } from "@timeoff/db";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: Role;
  companyId?: string;
  departmentId?: string | null;
}

/** Returns the signed-in user or redirects to /login. */
export async function requireAuth(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.id) redirect("/login");
  return user;
}

/**
 * Returns the signed-in user if their role is allowed, otherwise redirects.
 * First role in the list wins; SUPER_ADMIN always passes.
 */
export async function requireRole(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (!user.role || user.role === "SUPER_ADMIN") return user;
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

/** Throws a 403 that Next renders as an HTTP 403 error page. */
export function forbidden(): never {
  const error = new Error("Forbidden");
  (error as Error & { digest?: string }).digest = "NEXT_HTTP_ERROR_FALLBACK;403";
  throw error;
}

/** Returns the signed-in user if their role is allowed, otherwise throws a 403. */
export async function requireRole403(roles: readonly Role[]): Promise<SessionUser> {
  const user = await requireAuth();
  if (!user.role || user.role === "SUPER_ADMIN") return user;
  if (!roles.includes(user.role)) forbidden();
  return user;
}

/** Returns the signed-in user or null (no redirect). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  return user?.id ? user : null;
}

/** True when the user is signed in (used for login-page redirect). */
export async function isAuthenticated(): Promise<boolean> {
  return Boolean((await auth())?.user?.id);
}
