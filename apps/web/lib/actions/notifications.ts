"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/session";
import { prisma } from "@timeoff/db";

export interface NotificationActionState {
  ok?: boolean;
  error?: string;
}

/** Marks a single notification as read (own notifications only). */
export async function markNotificationReadAction(notificationId: string): Promise<NotificationActionState> {
  const user = await requireAuth();
  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications", "layout");
  return { ok: updated.count > 0 };
}

/** Marks every unread notification of the signed-in user as read. */
export async function markAllNotificationsReadAction(): Promise<NotificationActionState> {
  const user = await requireAuth();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications", "layout");
  return { ok: true };
}
