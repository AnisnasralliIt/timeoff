import type { Metadata } from "next";
import { prisma } from "@timeoff/db";
import { requireAuth } from "@/lib/session";
import { NotificationList } from "@/components/notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireAuth();
  const [unread, notifications] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <NotificationList
      unread={unread}
      items={notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        entityType: notification.entityType,
        entityId: notification.entityId,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      }))}
    />
  );
}
