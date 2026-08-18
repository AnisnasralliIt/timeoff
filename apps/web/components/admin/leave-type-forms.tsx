"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Briefcase, Pencil, SlidersHorizontal } from "lucide-react";
import { Button, Field, Input, Switch, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";
import { createLeaveTypeAction, updateLeaveTypeAction, updatePolicyAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CreateLeaveTypeDialog() {
  const t = useTranslations("adminDialogs.leaveType");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(createLeaveTypeAction, {});
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [requiresAttachment, setRequiresAttachment] = useState(false);
  const [isPaid, setIsPaid] = useState(true);
  const [negativeAllowed, setNegativeAllowed] = useState(false);
  const [accrualMethod, setAccrualMethod] = useState("CUMULATIVE_MONTHLY");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Briefcase className="size-4" />
          {t("createTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="requiresApproval" value={requiresApproval ? "on" : ""} />
          <input type="hidden" name="requiresAttachment" value={requiresAttachment ? "on" : ""} />
          <input type="hidden" name="isPaid" value={isPaid ? "on" : ""} />
          <input type="hidden" name="negativeAllowed" value={negativeAllowed ? "on" : ""} />
          <input type="hidden" name="accrualMethod" value={accrualMethod} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")} required id="name">
              <Input id="name" name="name" placeholder="Parental Leave" required />
            </Field>
            <Field label={t("color")} id="color">
              <Input id="color" name="color" type="color" defaultValue="#2e9486" className="h-10 p-1" />
            </Field>
            <Field label={t("annualAllotment")} id="annualAllotment">
              <Input id="annualAllotment" name="annualAllotment" type="number" step="0.5" defaultValue="0" />
            </Field>
            <Field label={t("carryOver")} id="carryOverDays">
              <Input id="carryOverDays" name="carryOverDays" type="number" step="0.5" defaultValue="0" />
            </Field>
            <Field label={t("probation")} id="probationDays">
              <Input id="probationDays" name="probationDays" type="number" defaultValue="0" />
            </Field>
            <Field label={t("accrualMethod")} id="accrualMethod">
              <Select value={accrualMethod} onValueChange={setAccrualMethod}>
                <SelectTrigger id="accrualMethod">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUMULATIVE_MONTHLY">
                    {t("accrualMethodCumulative")}
                  </SelectItem>
                  <SelectItem value="FIXED_ANNUAL">
                    {t("accrualMethodFixedAnnual")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("requiresApproval")}</span>
              <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("requiresAttachment")}</span>
              <Switch checked={requiresAttachment} onCheckedChange={setRequiresAttachment} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("paidLeave")}</span>
              <Switch checked={isPaid} onCheckedChange={setIsPaid} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("allowNegative")}</span>
              <Switch checked={negativeAllowed} onCheckedChange={setNegativeAllowed} />
            </label>
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
            <SubmitButton label={t("create")} pendingLabel={t("creating")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type Policy = {
  id: string;
  name: string;
  annualAllotment: number;
  carryOverDays: number;
  carryOverExpiresOn: string | null;
  negativeAllowed: boolean;
  probationDays: number;
  requiresApproval: boolean | null;
  requiresAttachment: boolean | null;
};

export function EditPolicyDialog({ policy }: { policy: Policy }) {
  const t = useTranslations("adminDialogs.leaveType");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(updatePolicyAction.bind(null, policy.id), {});
  const [negativeAllowed, setNegativeAllowed] = useState(policy.negativeAllowed);
  const [overrideApproval, setOverrideApproval] = useState(policy.requiresApproval !== null);
  const [requiresApproval, setRequiresApproval] = useState(policy.requiresApproval ?? true);
  const [overrideAttachment, setOverrideAttachment] = useState(policy.requiresAttachment !== null);
  const [requiresAttachment, setRequiresAttachment] = useState(policy.requiresAttachment ?? false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          {t("editTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{policy.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="negativeAllowed" value={negativeAllowed ? "on" : ""} />
          <input type="hidden" name="requiresApprovalOverride" value={overrideApproval ? "on" : ""} />
          <input type="hidden" name="requiresApproval" value={requiresApproval ? "on" : ""} />
          <input type="hidden" name="requiresAttachmentOverride" value={overrideAttachment ? "on" : ""} />
          <input type="hidden" name="requiresAttachment" value={requiresAttachment ? "on" : ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("annualAllotment")} id="annualAllotment">
              <Input id="annualAllotment" name="annualAllotment" type="number" step="0.5" defaultValue={policy.annualAllotment} />
            </Field>
            <Field label={t("carryOver")} id="carryOverDays">
              <Input id="carryOverDays" name="carryOverDays" type="number" step="0.5" defaultValue={policy.carryOverDays} />
            </Field>
            <Field label={t("carryOverExpiresOn")} id="carryOverExpiresOn">
              <Input id="carryOverExpiresOn" name="carryOverExpiresOn" placeholder="03-31" defaultValue={policy.carryOverExpiresOn ?? ""} />
            </Field>
            <Field label={t("probation")} id="probationDays">
              <Input id="probationDays" name="probationDays" type="number" defaultValue={policy.probationDays} />
            </Field>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("allowNegativeBalances")}</span>
              <Switch checked={negativeAllowed} onCheckedChange={setNegativeAllowed} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("overrideApproval")}</span>
              <Switch checked={overrideApproval} onCheckedChange={setOverrideApproval} />
            </label>
            {overrideApproval ? (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t("requestsNeedApproval")}</span>
                <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} />
              </label>
            ) : null}
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("overrideAttachment")}</span>
              <Switch checked={overrideAttachment} onCheckedChange={setOverrideAttachment} />
            </label>
            {overrideAttachment ? (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t("requestsNeedAttachment")}</span>
                <Switch checked={requiresAttachment} onCheckedChange={setRequiresAttachment} />
              </label>
            ) : null}
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
            <SubmitButton label={t("savePolicy")} pendingLabel={tCommon("saving")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type LeaveTypeDisplay = {
  id: string;
  name: string;
  nameEn: string | null;
  nameFr: string | null;
};

export function EditLeaveTypeDialog({ leaveType }: { leaveType: LeaveTypeDisplay }) {
  const t = useTranslations("adminDialogs.leaveType");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(updateLeaveTypeAction.bind(null, leaveType.id), {});

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" />
          {t("editLeaveTypeTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editLeaveTypeTitle")}</DialogTitle>
          <DialogDescription>{t("editLeaveTypeDescription", { name: leaveType.name })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("nameEn")} id="nameEn">
              <Input id="nameEn" name="nameEn" defaultValue={leaveType.nameEn ?? ""} placeholder={t("nameEnPlaceholder")} />
            </Field>
            <Field label={t("nameFr")} id="nameFr">
              <Input id="nameFr" name="nameFr" defaultValue={leaveType.nameFr ?? ""} placeholder={t("nameFrPlaceholder")} />
            </Field>
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
            <SubmitButton label={t("saveDisplayNames")} pendingLabel={tCommon("saving")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
