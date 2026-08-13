"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Input,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@timeoff/ui";
import { deleteUserAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

function SubmitButton({ label, pendingLabel, disabled }: { label: string; pendingLabel: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending || disabled}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function DeleteUserDialog({ userId, name, isSelf }: { userId: string; name: string; isSelf?: boolean }) {
  const t = useTranslations("adminDialogs.deleteUser");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction] = useActionState(deleteUserAction.bind(null, userId), {});

  // Close the dialog once the deletion has actually succeeded.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  const matches = confirmation.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={isSelf ? "contents" : undefined}>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={isSelf} onClick={() => setOpen(true)}>
              <Trash2 className="size-3.5" />
              {t("trigger")}
            </Button>
          </span>
        </TooltipTrigger>
        {isSelf ? <TooltipContent>{t("selfHint")}</TooltipContent> : null}
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { name })}</DialogTitle>
            <DialogDescription>{t("description", { name })}</DialogDescription>
          </DialogHeader>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="delete-confirm" className="text-sm font-medium text-foreground">
                {t("typeName", { name })}
              </label>
              <Input
                id="delete-confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoFocus
                placeholder={name}
                aria-invalid={confirmation.length > 0 && !matches}
              />
              <p className="text-xs text-muted-foreground">{t("typeHint")}</p>
            </div>
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
              <SubmitButton label={t("confirm")} pendingLabel={t("deleting")} disabled={!matches} />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
