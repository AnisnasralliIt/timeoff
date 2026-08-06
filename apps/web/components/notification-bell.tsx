import { prisma } from "@timeoff/db";
import { requireAuth } from "@/lib/session";
import { NotificationBellClient } from "./notification-bell-client";

/** Header bell: unread count + recent notifications (server-fetched). */
export async function NotificationBell() {
  const user = await requireAuth();
  const [unread, items] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);
  return (
    <NotificationBellClient
      unread={unread}
      items={items.map((notification) => ({
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
