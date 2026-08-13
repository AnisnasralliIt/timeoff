"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timeoff/ui";
import {
  createDelegationAction,
  deactivateDelegationAction,
} from "@/lib/actions/leave";
import { useServerError } from "@/lib/client-error";

export type DelegationWithPeople = {
  id: string;
  userId: string;
  delegateId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  createdAt: Date;
  user: { id: string; name: string; email: string };
  delegate: { id: string; name: string; email: string } | null;
};

export type DelegationCandidate = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function isActive(delegation: Pick<DelegationWithPeople, "startsOn" | "endsOn" | "active">): boolean {
  if (!delegation.active) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (delegation.startsOn && delegation.startsOn > today) return false;
  if (delegation.endsOn && delegation.endsOn < today) return false;
  return true;
}

function CreateDelegationForm({ candidates }: { candidates: DelegationCandidate[] }) {
  const t = useTranslations("delegation");
  const translateError = useServerError();
  const [state, formAction] = useActionState(createDelegationAction, {});
  const { pending } = useFormStatus();
  const [delegateId, setDelegateId] = useState("");

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="delegateId" value={delegateId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Label htmlFor="delegateId">{t("delegate")}</Label>
          <Select value={delegateId} onValueChange={setDelegateId}>
            <SelectTrigger id="delegateId" className="mt-1">
              <SelectValue placeholder={t("whoCoversYou")} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c: (typeof candidates)[number]) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {c.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="startsOn">{t("starts")}</Label>
          <Input id="startsOn" name="startsOn" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="endsOn">{t("ends")}</Label>
          <Input id="endsOn" name="endsOn" type="date" className="mt-1" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("whileActive")}
        </p>
        <Button type="submit" disabled={pending || !delegateId}>
          <Plus className="size-4" />
          {t("create")}
        </Button>
      </div>
      {translateError(state) ? (
        <p className="text-sm text-destructive">{translateError(state)}</p>
      ) : null}
    </form>
  );
}

function DelegationRow({
  delegation,
  viewAsOwner,
}: {
  delegation: DelegationWithPeople;
  viewAsOwner: boolean;
}) {
  const t = useTranslations("delegation");
  const locale = useLocale();
  const translateError = useServerError();
  const [state, formAction] = useActionState(
    deactivateDelegationAction.bind(null, delegation.id),
    {},
  );
  const active = isActive(delegation);
  const byLine = viewAsOwner
    ? delegation.delegate
      ? t("coversYourApprovals", { name: delegation.delegate.name })
      : t("coversYourApprovalsDeleted")
    : t("youCover", { name: delegation.user.name });
  const span =
    delegation.startsOn && delegation.endsOn
      ? `${delegation.startsOn} → ${delegation.endsOn}`
      : delegation.startsOn
        ? t("from", { date: delegation.startsOn })
        : delegation.endsOn
          ? t("until", { date: delegation.endsOn })
          : t("noEndDate");

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{byLine}</p>
          {active ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : (
            <Badge variant="neutral">{delegation.active ? t("scheduled") : t("inactive")}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {span} · {t("createdAt", { date: delegation.createdAt.toLocaleDateString(locale) })}
        </p>
        {translateError(state) ? <p className="mt-1 text-xs text-destructive">{translateError(state)}</p> : null}
      </div>
      {delegation.active && viewAsOwner ? (
        <form action={formAction}>
          <Button variant="ghost" size="sm" type="submit">
            <X className="size-4" />
            {t("deactivate")}
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export function DelegationPanelClient({
  delegations,
  candidates,
  canDelegate,
  userId,
}: {
  delegations: DelegationWithPeople[];
  candidates: DelegationCandidate[];
  canDelegate: boolean;
  userId: string;
}) {
  const t = useTranslations("delegation");
  return (
    <div className="space-y-4">
      {canDelegate ? <CreateDelegationForm candidates={candidates} /> : null}
      {delegations.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {delegations.map((delegation: (typeof delegations)[number]) => (
            <DelegationRow
              key={delegation.id}
              delegation={delegation}
              viewAsOwner={delegation.userId === userId}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canDelegate ? t("noDelegationsOwner") : t("noDelegations")}
        </p>
      )}
    </div>
  );
}
