"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Switch } from "@timeoff/ui";
import { updateCompanySettingsAction, type ActionState } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

export function CompanySettingsForm({
  countWeekendsWithinSpan,
  extendWeekendAfterFriday,
  countHolidaysAsVacationDays,
  halfDayEnabled,
  halfDayStartDay,
  halfDayEndDay,
}: {
  countWeekendsWithinSpan: boolean;
  extendWeekendAfterFriday: boolean;
  countHolidaysAsVacationDays: boolean;
  halfDayEnabled: boolean;
  halfDayStartDay: boolean;
  halfDayEndDay: boolean;
}) {
  const t = useTranslations("adminSettings");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateCompanySettingsAction,
    {},
  );
  const [withinSpan, setWithinSpan] = React.useState(countWeekendsWithinSpan);
  const [afterFriday, setAfterFriday] = React.useState(extendWeekendAfterFriday);
  const [countHolidays, setCountHolidays] = React.useState(countHolidaysAsVacationDays);
  const [halfDay, setHalfDay] = React.useState(halfDayEnabled);
  const [halfDayStart, setHalfDayStart] = React.useState(halfDayStartDay);
  const [halfDayEnd, setHalfDayEnd] = React.useState(halfDayEndDay);

  // After a successful save, pin the switches to the server-confirmed values so
  // a toggle can never silently revert to a stale value.
  React.useEffect(() => {
    if (state.ok && state.saved) {
      setWithinSpan(state.saved.countWeekendsWithinSpan);
      setAfterFriday(state.saved.extendWeekendAfterFriday);
      setCountHolidays(state.saved.countHolidaysAsVacationDays);
      setHalfDay(state.saved.halfDayEnabled);
      setHalfDayStart(state.saved.halfDayStartDay);
      setHalfDayEnd(state.saved.halfDayEndDay);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <label
        htmlFor="countWeekendsWithinSpan"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("countWeekendsLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("countWeekendsHint")}</span>
        </span>
        <Switch
          id="countWeekendsWithinSpan"
          checked={withinSpan}
          onCheckedChange={setWithinSpan}
          aria-label={t("countWeekendsLabel")}
        />
      </label>
      <input type="hidden" name="countWeekendsWithinSpan" value={withinSpan ? "on" : "off"} />

      <label
        htmlFor="extendWeekendAfterFriday"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("extendWeekendLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("extendWeekendHint")}</span>
        </span>
        <Switch
          id="extendWeekendAfterFriday"
          checked={afterFriday}
          onCheckedChange={setAfterFriday}
          aria-label={t("extendWeekendLabel")}
        />
      </label>
      <input type="hidden" name="extendWeekendAfterFriday" value={afterFriday ? "on" : "off"} />

      <label
        htmlFor="countHolidaysAsVacationDays"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("countHolidaysLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("countHolidaysHint")}</span>
        </span>
        <Switch
          id="countHolidaysAsVacationDays"
          checked={countHolidays}
          onCheckedChange={setCountHolidays}
          aria-label={t("countHolidaysLabel")}
        />
      </label>
      <input type="hidden" name="countHolidaysAsVacationDays" value={countHolidays ? "on" : "off"} />

      <label
        htmlFor="halfDayEnabled"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("halfDayEnabledLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("halfDayEnabledHint")}</span>
        </span>
        <Switch
          id="halfDayEnabled"
          checked={halfDay}
          onCheckedChange={setHalfDay}
          aria-label={t("halfDayEnabledLabel")}
        />
      </label>
      <input type="hidden" name="halfDayEnabled" value={halfDay ? "on" : "off"} />

      <label
        htmlFor="halfDayStartDay"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("halfDayStartDayLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("halfDayStartDayHint")}</span>
        </span>
        <Switch
          id="halfDayStartDay"
          checked={halfDayStart}
          onCheckedChange={setHalfDayStart}
          aria-label={t("halfDayStartDayLabel")}
        />
      </label>
      <input type="hidden" name="halfDayStartDay" value={halfDayStart ? "on" : "off"} />

      <label
        htmlFor="halfDayEndDay"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t("halfDayEndDayLabel")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("halfDayEndDayHint")}</span>
        </span>
        <Switch
          id="halfDayEndDay"
          checked={halfDayEnd}
          onCheckedChange={setHalfDayEnd}
          aria-label={t("halfDayEndDayLabel")}
        />
      </label>
      <input type="hidden" name="halfDayEndDay" value={halfDayEnd ? "on" : "off"} />

      {translateError(state) ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {translateError(state)}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("saving") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}
