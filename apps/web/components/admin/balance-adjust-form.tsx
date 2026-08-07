"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@timeoff/ui";
import { adjustBalanceAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

type User = { id: string; name: string };
type LeaveType = { id: string; name: string };
type BalanceRow = { id: string; userName: string; userEmail: string; leaveType: string; periodStart: string; available: number };

function SubmitButton() {
  const t = useTranslations("adminDialogs.balance");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("applying") : t("apply")}
    </Button>
  );
}

export function BalanceAdjustDialog({
  users,
  leaveTypes,
  periodOptions,
}: {
  users: User[];
  leaveTypes: LeaveType[];
  periodOptions: { start: string; label: string }[];
}) {
  const t = useTranslations("adminDialogs.balance");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(adjustBalanceAction, {});
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState(periodOptions[0]?.start ?? "");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Wallet className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
          <input type="hidden" name="periodStart" value={periodStart} />
          <Field label={t("user")} required id="userId">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="userId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users.map((u: (typeof users)[number]) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("leaveType")} required id="leaveTypeId">
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger id="leaveTypeId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((lt: (typeof leaveTypes)[number]) => (
                  <SelectItem key={lt.id} value={lt.id}>
                    {lt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("leaveYear")} required id="periodStart">
              <Select value={periodStart} onValueChange={setPeriodStart}>
                <SelectTrigger id="periodStart">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((p: (typeof periodOptions)[number]) => (
                    <SelectItem key={p.start} value={p.start}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("days")} required id="delta">
              <Input id="delta" name="delta" type="number" step="0.5" placeholder="e.g. 3 or -1.5" required />
            </Field>
          </div>
          <Field label={t("reason")} required id="reason">
            <Input id="reason" name="reason" placeholder="e.g. Public holiday worked" required />
          </Field>
          {translateError(state) ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BalanceRowSummary({ row }: { row: BalanceRow }) {
  const t = useTranslations("common");
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{row.userName}</p>
        <p className="truncate text-xs text-muted-foreground">{row.userEmail}</p>
      </div>
      <div className="ml-auto text-right">
        <p className="text-sm font-semibold text-foreground">
          {t("dayCount", { count: row.available })}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.leaveType} · {row.periodStart.slice(0, 4)}
        </p>
      </div>
    </div>
  );
}
