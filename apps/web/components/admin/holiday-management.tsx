"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";
import type { HolidayListItem } from "@/lib/services/holidays";
import { AddHolidayDialog, EditHolidayDialog, DeleteHolidayDialog } from "@/components/admin/holiday-forms";
import { NagerImportDialog } from "@/components/admin/nager-import-dialog";

export function HolidayManagement({
  holidays,
  defaultCountryCode,
}: {
  holidays: HolidayListItem[];
  defaultCountryCode: string;
}) {
  const t = useTranslations("adminHolidays");
  const locale = useLocale();
  const [year, setYear] = useState<string>("all");

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const h of holidays) {
      if (!h.isRecurring) set.add(Number(h.date.slice(0, 4)));
    }
    return [...set].sort((a, b) => b - a);
  }, [holidays]);

  const visible = useMemo(() => {
    return holidays.filter(
      (h) => year === "all" || h.isRecurring || h.date.startsWith(year),
    );
  }, [holidays, year]);

  const existingDates = useMemo(() => holidays.map((h) => h.date), [holidays]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: visible.length })}
        </p>
        <div className="flex items-center gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allYears")}</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NagerImportDialog defaultCountryCode={defaultCountryCode} existingHolidayDates={existingDates} />
          <AddHolidayDialog defaultCountryCode={defaultCountryCode} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">{t("date")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("holiday")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("type")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("source")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.id} className="border-t border-border">
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                  {new Date(`${h.date}T00:00:00`).toLocaleDateString(locale, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                  {h.isRecurring ? (
                    <span className="ml-2 text-xs text-muted-foreground">({t("recurring")})</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 font-medium text-foreground">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {h.name}
                    {h.global ? <Badge variant="success">{t("national")}</Badge> : null}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {h.holidayTypes.join(", ") || "—"}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={h.source === "NAGER_DATE" ? "info" : "neutral"}>
                    {h.source === "NAGER_DATE" ? t("sourceNager") : t("sourceManual")}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <EditHolidayDialog
                      holiday={{ id: h.id, name: h.name, date: h.date, holidayTypes: h.holidayTypes }}
                    />
                    <DeleteHolidayDialog holiday={{ id: h.id, name: h.name, date: h.date, holidayTypes: h.holidayTypes }} />
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {year === "all" ? t("empty") : t("noYearHolidays", { year })}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
