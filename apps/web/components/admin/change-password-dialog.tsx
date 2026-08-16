"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from "@timeoff/ui";
import { changeUserPasswordAction, type ActionState } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("adminDialogs.changePassword");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? t("changing") : t("changePassword")}
    </Button>
  );
}

export function ChangePasswordDialog({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("adminDialogs.changePassword");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState<ActionState, FormData>(
    (prev, formData) => changeUserPasswordAction(userId, prev, formData),
    {},
  );
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  // Clear the inputs once the new password is saved so reopening the dialog
  // never carries a stale value.
  React.useEffect(() => {
    if (state.ok) {
      setPassword("");
      setConfirm("");
    }
  }, [state]);

  const passwordMismatch = password.length > 0 && confirm.length > 0 && password !== confirm;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4">
            <Field label={t("newPassword")} required id="password">
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                minLength={8}
                required
              />
            </Field>
            <Field label={t("confirmPassword")} required id="confirm">
              <Input
                id="confirm"
                name="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("repeatPassword")}
                minLength={8}
                required
              />
            </Field>
          </div>
          {passwordMismatch ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {t("passwordMismatch")}
            </p>
          ) : null}
          {translateError(state) ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          {state.ok ? (
            <p role="status" className="text-xs font-medium text-success">
              {t("success")}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <SubmitButton disabled={passwordMismatch || password.length < 8} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
