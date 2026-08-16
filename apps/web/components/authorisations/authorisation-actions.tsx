"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
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
import {
  approveAuthorisationRequestAction,
  rejectAuthorisationRequestAction,
  type ActionState,
} from "@/lib/actions/authorisations";
import { useServerError } from "@/lib/client-error";

export function ApproveAuthorisationButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations("approvalDialogs");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [pending, startTransition] = React.useTransition();

  const approve = () => {
    startTransition(async () => {
      const state: ActionState = await approveAuthorisationRequestAction(requestId, {});
      if (state.ok) {
        toast.success(tToast("requestApproved"));
        router.refresh();
      } else {
        const error = translateError(state);
        if (error) toast.error(error);
      }
    });
  };

  return (
    <Button size="sm" onClick={approve} disabled={pending}>
      <Check className="size-3.5" />
      {pending ? t("approving") : t("approve")}
    </Button>
  );
}

export function RejectAuthorisationDialog({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations("approvalDialogs");
  const tCommon = useTranslations("common");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(
    rejectAuthorisationRequestAction.bind(null, requestId),
    {},
  );

  React.useEffect(() => {
    if (state.ok) {
      toast.success(tToast("requestDeclined"));
      setOpen(false);
      router.refresh();
    } else if (state.error || state.errorCode) {
      const error = translateError(state);
      if (error) toast.error(error);
    }
  }, [state, router, tToast, translateError]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <X className="size-3.5" />
          {t("reject")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rejectTitle")}</DialogTitle>
          <DialogDescription>{t("rejectDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <Field label={t("reason")} required id="reject-authorisation-reason">
            <Textarea id="reject-authorisation-reason" name="reason" rows={3} />
          </Field>
          {state.error || state.errorCode ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tCommon("back")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? t("rejecting") : t("declineRequest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
