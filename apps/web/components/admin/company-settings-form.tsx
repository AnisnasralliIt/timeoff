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
}: {
  countWeekendsWithinSpan: boolean;
  extendWeekendAfterFriday: boolean;
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

  // After a successful save, pin the switches to the server-confirmed values so
  // a toggle can never silently revert to a stale value.
  React.useEffect(() => {
    if (state.ok && state.saved) {
      setWithinSpan(state.saved.countWeekendsWithinSpan);
      setAfterFriday(state.saved.extendWeekendAfterFriday);
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
