import { Shell } from "@/components/shell";
import { NotificationBell } from "@/components/notification-bell";
import { requireAuth } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  return (
    <Shell user={user} notifications={<NotificationBell />}>
      {children}
    </Shell>
  );
}
