"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@timeoff/ui";
import {
  createHolidayAction,
  updateHolidayAction,
  deleteHolidayAction,
} from "@/lib/actions/holidays";
import { useServerError } from "@/lib/client-error";
import { NAGER_HOLIDAY_TYPES } from "@timeoff/domain";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Localized holiday type options (mirrors Nager.Date `types`). */
export function HolidayTypeSelect({
  name,
  defaultValue,
  placeholder,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
}) {
  const t = useTranslations("adminDialogs.holiday");
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value || undefined} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {NAGER_HOLIDAY_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {t(`type.${type}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

interface HolidayFields {
  id: string;
  name: string;
  date: string;
  holidayTypes: string[];
}

export function AddHolidayDialog({ defaultCountryCode }: { defaultCountryCode: string }) {
  const t = useTranslations("adminDialogs.holiday");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(createHolidayAction, {});

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus className="size-4" />
          {t("createTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="countryCode" value={defaultCountryCode} />
          <Field label={t("name")} required id="holidayName">
            <Input id="holidayName" name="name" placeholder={t("namePlaceholder")} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("date")} required id="holidayDate">
              <Input id="holidayDate" name="date" type="date" required />
            </Field>
            <Field label={t("type.label")} id="holidayType">
              <HolidayTypeSelect name="holidayTypes" placeholder={t("typePlaceholder")} />
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
            <SubmitButton label={t("create")} pendingLabel={t("creating")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditHolidayDialog({ holiday }: { holiday: HolidayFields }) {
  const t = useTranslations("adminDialogs.holiday");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(updateHolidayAction.bind(null, holiday.id), {});

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" />
          {t("editTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <Field label={t("name")} required id="holidayName">
            <Input id="holidayName" name="name" defaultValue={holiday.name} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("date")} required id="holidayDate">
              <Input id="holidayDate" name="date" type="date" defaultValue={holiday.date} required />
            </Field>
            <Field label={t("type.label")} id="holidayType">
              <HolidayTypeSelect
                name="holidayTypes"
                defaultValue={holiday.holidayTypes[0]}
                placeholder={t("typePlaceholder")}
              />
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
            <SubmitButton label={tCommon("save")} pendingLabel={tCommon("saving")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteHolidayDialog({ holiday }: { holiday: HolidayFields }) {
  const t = useTranslations("adminDialogs.holiday");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction] = useActionState(deleteHolidayAction.bind(null, holiday.id), {});

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("deleteTrigger")}>
          <Trash2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: holiday.name })}</DialogTitle>
          <DialogDescription>{t("deleteDescription")}</DialogDescription>
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
            <SubmitButton label={t("deleteConfirm")} pendingLabel={tCommon("saving")} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
