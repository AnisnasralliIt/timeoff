import { Shell } from "@/components/shell";
import { NotificationBell } from "@/components/notification-bell";
import { requireAuth } from "@/lib/session";
import { getAuthorisationPolicy } from "@/lib/services/authorisations";
import { prisma } from "@timeoff/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const authorisationPolicy = await getAuthorisationPolicy(prisma, user.companyId!);
  return (
    <Shell
      user={user}
      notifications={<NotificationBell />}
      authorisationsEnabled={Boolean(authorisationPolicy?.enabled)}
    >
      {children}
    </Shell>
  );
}
