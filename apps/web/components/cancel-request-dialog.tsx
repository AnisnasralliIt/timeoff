"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@timeoff/ui";
import { Button } from "@timeoff/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@timeoff/ui";
import { Field } from "@timeoff/ui";
import { Textarea } from "@timeoff/ui";
import { X } from "lucide-react";
import { cancelLeaveRequestAction, type ActionState } from "@/lib/actions/leave";
import { useServerError } from "@/lib/client-error";

export function CancelRequestDialog({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations("approvalDialogs");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = React.useActionState<
    ActionState,
    FormData
  >(cancelLeaveRequestAction.bind(null, requestId), {});

  React.useEffect(() => {
    if (state.ok) {
      toast.success(tToast("requestCancelled"));
      setOpen(false);
      router.refresh();
    } else {
      const error = translateError(state);
      if (error) toast.error(error);
    }
  }, [state, router, tToast, translateError]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <X className="size-3.5" />
          {t("cancel")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelTitle")}</DialogTitle>
          <DialogDescription>{t("cancelDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <Field
            label={t("reason")}
            id="cancel-reason"
            hint={t("cancelReasonHint")}
          >
            <Textarea id="cancel-reason" name="reason" rows={3} />
          </Field>
          {state.error || state.errorCode ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("keepIt")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? t("cancelling") : t("cancelRequest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
