import { getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import type { SessionUser } from "@/lib/session";
import { listDelegations, listDelegationCandidates } from "@/lib/services/leave";
import { DelegationPanelClient } from "@/components/delegation-panel-client";

export default async function DelegationPanel({ user }: { user: SessionUser }) {
  const t = await getTranslations("delegation");
  const canDelegate = user.role === "MANAGER" || user.role === "HR" || user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  const [delegations, candidates] = await Promise.all([
    listDelegations(user),
    listDelegationCandidates(user),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DelegationPanelClient
          delegations={delegations}
          candidates={candidates}
          canDelegate={canDelegate}
          userId={user.id}
        />
      </CardContent>
    </Card>
  );
}
