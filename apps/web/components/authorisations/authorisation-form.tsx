"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  adjustAuthorisationEndToMinimum,
  authorisationDurationHours,
  formatAuthorisationTime,
  validateAuthorisationTimeRange,
} from "@timeoff/domain";
import { toast } from "@timeoff/ui";
import { Button } from "@timeoff/ui";
import { Field } from "@timeoff/ui";
import { Input } from "@timeoff/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";
import { Textarea } from "@timeoff/ui";
import { createAuthorisationRequestAction, type ActionState } from "@/lib/actions/authorisations";
import { useServerError } from "@/lib/client-error";

const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, index) =>
  formatAuthorisationTime(index * 30),
);

export function AuthorisationForm({
  minHours,
  maxHours,
  incrementHours,
  available,
  periodStart,
  periodEnd,
}: {
  minHours: number;
  maxHours: number;
  incrementHours: number;
  available: number;
  periodStart: string;
  periodEnd: string;
}) {
  const router = useRouter();
  const t = useTranslations("authorisations");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(
    createAuthorisationRequestAction,
    {},
  );
  const [date, setDate] = React.useState("");
  const [startTime, setStartTime] = React.useState("08:00");
  const [endTime, setEndTime] = React.useState("10:00");
  const [reason, setReason] = React.useState("");
  const [autoAdjustedTo, setAutoAdjustedTo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state.ok && state.requestId) {
      toast.success(tToast("authorisationRequested"));
      router.push("/authorisations");
    } else if (state.error || state.errorCode) {
      const error = translateError(state);
      if (error) toast.error(error);
    }
  }, [state, router, tToast, translateError]);

  // Snaps a newly selected range up to the minimum duration (end pushed forward,
  // start never moved). The employee sees the message explaining the adjustment.
  const applyRange = (nextStart: string, nextEnd: string, moveStart: boolean) => {
    setAutoAdjustedTo(null);
    if (moveStart) setStartTime(nextStart);
    const duration = authorisationDurationHours(nextStart, nextEnd);
    if (duration !== null && duration < minHours) {
      const adjusted = adjustAuthorisationEndToMinimum(nextStart, nextEnd, minHours);
      if (adjusted !== null && adjusted !== nextEnd) {
        setAutoAdjustedTo(adjusted);
        setEndTime(adjusted);
        return;
      }
    }
    setEndTime(nextEnd);
  };

  const duration = authorisationDurationHours(startTime, endTime);
  let blockingError: string | null = null;
  if (duration !== null) {
    if (duration < minHours) {
      if (adjustAuthorisationEndToMinimum(startTime, endTime, minHours) === null) {
        blockingError = t("notEnoughTime", { min: minHours });
      }
    } else if (duration > maxHours) {
      blockingError = t("aboveMaximum", { max: maxHours });
    } else if (duration > available) {
      blockingError = t("insufficient", { available, requested: duration });
    } else if (incrementHours > 0 && Math.abs(duration % incrementHours) > 1e-6) {
      blockingError = t("notIncrement", { increment: incrementHours });
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label={t("date")} required id="authorisation-date">
        <Input
          id="authorisation-date"
          type="date"
          min={periodStart}
          max={periodEnd}
          required
          value={date}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("startTime")} required id="authorisation-start">
          <Select
            value={startTime}
            onValueChange={(value: string) => applyRange(value, endTime, true)}
          >
            <SelectTrigger id="authorisation-start">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("endTime")} required id="authorisation-end">
          <Select value={endTime} onValueChange={(value: string) => applyRange(startTime, value, false)}>
            <SelectTrigger id="authorisation-end">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {date && startTime && endTime ? (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
          {validateAuthorisationTimeRange(startTime, endTime) ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t("endNotAfterStart")}
            </p>
          ) : duration !== null ? (
            <>
              <p className="text-sm text-foreground">
                {t("duration")}:{" "}
                <span className="font-display text-lg font-semibold">
                  {t("hours", { count: duration })}
                </span>
              </p>
              {autoAdjustedTo ? (
                <p className="mt-1 text-xs font-medium text-foreground">
                  {t("minimumAdjusted", { min: minHours, end: autoAdjustedTo })}
                </p>
              ) : null}
              {blockingError ? (
                <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                  {blockingError}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {t("rangeHint", { start: startTime, end: endTime, min: minHours, max: maxHours })}
              </p>
            </>
          ) : (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t("endNotAfterStart")}
            </p>
          )}
        </div>
      ) : null}

      <Field label={t("reason")} hint={t("reasonHint")} id="authorisation-reason">
        <Textarea
          id="authorisation-reason"
          name="reason"
          rows={3}
          value={reason}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
        />
      </Field>

      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="startTime" value={startTime} />
      <input type="hidden" name="endTime" value={endTime} />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {t("available")}: {t("hours", { count: available })}
        </p>
        <Button
          type="submit"
          disabled={
            pending ||
            !date ||
            Boolean(validateAuthorisationTimeRange(startTime, endTime)) ||
            duration === null ||
            Boolean(blockingError)
          }
        >
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
