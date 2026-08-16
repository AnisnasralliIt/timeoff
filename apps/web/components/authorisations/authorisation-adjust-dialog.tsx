"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@timeoff/ui";
import { adjustAuthorisationBalanceAction } from "@/lib/actions/authorisations";
import { useServerError } from "@/lib/client-error";

type User = { id: string; name: string };

function SubmitButton() {
  const t = useTranslations("authorisationsAdjust");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("applying") : t("apply")}
    </Button>
  );
}

export function AuthorisationAdjustDialog({ users }: { users: User[] }) {
  const t = useTranslations("authorisationsAdjust");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(adjustAuthorisationBalanceAction, {});
  const [userId, setUserId] = useState(users[0]?.id ?? "");

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
          <Field label={t("user")} required id="authorisation-adjust-user">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="authorisation-adjust-user">
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
          <Field label={t("hours")} required hint={t("hoursHint")} id="authorisation-adjust-delta">
            <Input id="authorisation-adjust-delta" name="delta" type="number" step="0.5" required />
          </Field>
          <Field label={t("reason")} required id="authorisation-adjust-reason">
            <Input id="authorisation-adjust-reason" name="reason" required />
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
