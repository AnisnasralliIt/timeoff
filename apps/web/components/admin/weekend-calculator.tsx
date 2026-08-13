"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { computeLeaveDays } from "@timeoff/domain";
import { Field, Input } from "@timeoff/ui";

interface WeekendCalculatorProps {
  countWeekendsWithinSpan: boolean;
  extendWeekendAfterFriday: boolean;
  holidayDates: string[];
}

/**
 * §2.4: an interactive preview of the deduction for a chosen range, using the
 * exact same shared calculation function as real requests. Always evaluates
 * against the *saved* company settings so HR can verify the rule before it
 * affects real employees.
 */
export function WeekendCalculator({
  countWeekendsWithinSpan,
  extendWeekendAfterFriday,
  holidayDates,
}: WeekendCalculatorProps) {
  const t = useTranslations("adminSettings");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");

  const holidays = React.useMemo(() => new Set(holidayDates), [holidayDates]);

  const preview = React.useMemo(() => {
    if (!start || !end) return null;
    try {
      return computeLeaveDays(
        { startDate: start, endDate: end },
        { holidays, countWeekendsWithinSpan, extendWeekendAfterFriday },
      );
    } catch {
      return null;
    }
  }, [start, end, holidays, countWeekendsWithinSpan, extendWeekendAfterFriday]);

  const selectedDays = preview
    ? preview.days.reduce((sum, day) => sum + (day.dayPart === "FULL" ? 1 : 0.5), 0)
    : 0;
  const extended = Boolean(preview && preview.totalDays > selectedDays);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("calculatorStart")} required id="calcStart">
          <Input id="calcStart" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t("calculatorEnd")} required id="calcEnd">
          <Input id="calcEnd" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      {!preview ? (
        <p className="text-sm text-muted-foreground">{t("calculatorPickRange")}</p>
      ) : (
        <div className="rounded-md border border-border px-4 py-3">
          <p className="text-sm">
            <span className="font-display text-lg font-semibold text-foreground">
              {preview.totalDays}
            </span>{" "}
            <span className="text-muted-foreground">
              {t("calculatorResult", { count: preview.totalDays })}
            </span>
          </p>
          {extended ? (
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              {t("calculatorSelected", { count: selectedDays })} ·{" "}
              {t("calculatorResult", { count: preview.totalDays })}{" "}
              <span className="text-foreground">{t("calculatorIncludesWeekend")}</span>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
