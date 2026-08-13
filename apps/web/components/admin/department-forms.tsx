"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Building2, Pencil, Trash2 } from "lucide-react";
import { Button, Field, Input, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@timeoff/ui";
import { createDepartmentAction, renameDepartmentAction, removeDepartmentAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CreateDepartmentDialog() {
  const t = useTranslations("adminDialogs.department");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(createDepartmentAction, {});
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Building2 className="size-4" />
          {t("createTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <Field label={t("name")} required id="name">
            <Input id="name" name="name" placeholder="Growth" required />
          </Field>
          <Field label={t("code")} id="code">
            <Input id="code" name="code" placeholder="GRO" />
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
            <SubmitButton label={t("create")} pendingLabel={t("creating")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDepartmentDialog({ id, name }: { id: string; name: string }) {
  const t = useTranslations("adminDialogs.department");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(renameDepartmentAction.bind(null, id), {});
  const [value, setValue] = useState(name);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="size-3.5" />
          {t("renameTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("renameTitle")}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <Field label={t("name")} required id="name">
            <Input id="name" name="name" value={value} onChange={(e) => setValue(e.target.value)} required />
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
            <SubmitButton label={tCommon("save")} pendingLabel={tCommon("saving")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDepartmentDialog({ id, name }: { id: string; name: string }) {
  const t = useTranslations("adminDialogs.department");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(removeDepartmentAction.bind(null, id), {});
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Trash2 className="size-3.5" />
          {t("deleteTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("deleteDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
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
            <SubmitButton label={t("deleteConfirm")} pendingLabel={t("deleting")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
