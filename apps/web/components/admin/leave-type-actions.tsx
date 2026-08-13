"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@timeoff/ui";
import {
  archiveLeaveTypeAction,
  reactivateLeaveTypeAction,
  deleteLeaveTypeAction,
  type ActionState,
} from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

type BoundAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ShowArchivedToggle() {
  const t = useTranslations("adminLeaveTypes");
  const router = useRouter();
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("showArchived") === "1";

  return (
    <Button
      variant={showArchived ? "secondary" : "outline"}
      size="sm"
      onClick={() => router.push(showArchived ? "/admin/leave-types" : "/admin/leave-types?showArchived=1")}
    >
      {showArchived ? t("showActive") : t("showArchived")}
    </Button>
  );
}


function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmPendingLabel,
  action,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmPendingLabel: string;
  action: BoundAction;
}) {
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(action, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          {translateError(state) ? (
            <p role="alert" className="mb-4 text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <SubmitButton label={confirmLabel} pendingLabel={confirmPendingLabel} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveTypeActions({
  leaveTypeId,
  name,
  isArchived,
  hasHistory,
}: {
  leaveTypeId: string;
  name: string;
  isArchived: boolean;
  hasHistory: boolean;
}) {
  const t = useTranslations("adminLeaveTypes");
  const tCommon = useTranslations("common");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isArchived) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
          <ArchiveRestore className="size-3.5" />
          {t("reactivateTrigger")}
        </Button>
        <ConfirmActionDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={t("reactivateTrigger")}
          description={t("archiveDescription")}
          confirmLabel={t("reactivateTrigger")}
          confirmPendingLabel={tCommon("saving")}
          action={reactivateLeaveTypeAction.bind(null, leaveTypeId)}
        />
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
        <Archive className="size-3.5" />
        {t("archiveTrigger")}
      </Button>
      <ConfirmActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("archiveTitle", { name })}
        description={t("archiveDescription")}
        confirmLabel={t("archiveConfirm")}
        confirmPendingLabel={tCommon("saving")}
        action={archiveLeaveTypeAction.bind(null, leaveTypeId)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("moreActions")}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="contents">
                <DropdownMenuItem destructive disabled={hasHistory} onSelect={() => setDeleteOpen(true)}>
                  <Trash2 />
                  {t("deleteTrigger")}
                </DropdownMenuItem>
              </span>
            </TooltipTrigger>
            {hasHistory ? <TooltipContent>{t("deleteDisabledHint")}</TooltipContent> : null}
          </Tooltip>
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle", { name })}
        description={t("deleteDescription")}
        confirmLabel={t("deleteConfirm")}
        confirmPendingLabel={tCommon("saving")}
        action={deleteLeaveTypeAction.bind(null, leaveTypeId)}
      />
    </div>
  );
}
