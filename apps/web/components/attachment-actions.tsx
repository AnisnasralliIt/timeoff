"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Paperclip, Trash2 } from "lucide-react";
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
import { AttachmentUpload } from "@/components/attachment-upload";
import { attachAttachmentAction, deleteAttachmentAction, type ActionState } from "@/lib/actions/attachments";
import { useServerError } from "@/lib/client-error";

/** Adds a staged attachment to an existing request (requester or HR). */
export function AddAttachmentButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations("attachments");
  const tDialog = useTranslations("approvalDialogs");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [open, setOpen] = React.useState(false);
  const [attachmentId, setAttachmentId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const attach = () => {
    if (!attachmentId) return;
    startTransition(async () => {
      const state: ActionState = await attachAttachmentAction(attachmentId, requestId, {});
      if (state.ok) {
        toast.success(tToast("attachmentAdded"));
        setOpen(false);
        setAttachmentId(null);
        router.refresh();
      } else {
        setError(translateError(state));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Paperclip className="size-3.5" />
          {t("addFile")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{t("addDescription")}</DialogDescription>
        </DialogHeader>
        <AttachmentUpload value={attachmentId} onChange={setAttachmentId} />
        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tDialog("cancel")}
          </Button>
          <Button type="button" onClick={attach} disabled={!attachmentId || pending}>
            {pending ? t("attaching") : t("attach")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes an attachment (uploader, requester, or HR). */
export function DeleteAttachmentButton({
  attachmentId,
  requestId,
}: {
  attachmentId: string;
  requestId: string;
}) {
  const router = useRouter();
  const t = useTranslations("attachments");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [pending, startTransition] = React.useTransition();

  const remove = () => {
    startTransition(async () => {
      const state: ActionState = await deleteAttachmentAction(attachmentId, requestId, {});
      if (state.ok) {
        toast.success(tToast("fileRemoved"));
        router.refresh();
      } else {
        const error = translateError(state);
        if (error) toast.error(error);
      }
    });
  };

  return (
    <Button variant="ghost" size="icon" onClick={remove} disabled={pending} aria-label={t("deleteAria")}>
      <Trash2 className="size-4" />
    </Button>
  );
}
