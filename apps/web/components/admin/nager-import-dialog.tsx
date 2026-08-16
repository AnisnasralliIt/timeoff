"use client";

import * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CloudDownload, Globe2, RefreshCw } from "lucide-react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@timeoff/ui";
import {
  defaultSelectedDates,
  isNationalOrPublic,
  type NagerHoliday,
} from "@timeoff/domain";
import { COUNTRIES } from "@/lib/countries";
import {
  fetchNagerHolidaysAction,
  importNagerHolidaysAction,
  type FetchNagerState,
} from "@/lib/actions/holidays";
import { useServerError } from "@/lib/client-error";

const MIN_IMPORT_YEAR = 1900;
const MAX_IMPORT_YEAR = 2100;

function SummaryRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className="font-display font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function NagerImportDialog({
  defaultCountryCode,
  existingHolidayDates,
}: {
  defaultCountryCode: string;
  existingHolidayDates: readonly string[];
}) {
  const t = useTranslations("nagerImport");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const translateError = useServerError();
  const router = useRouter();

  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [fetched, setFetched] = useState<NagerHoliday[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [fetchState, setFetchState] = useState<FetchNagerState | null>(null);
  const [importState, formAction] = useActionState(importNagerHolidaysAction, {});
  const [open, setOpen] = useState(false);

  const existingDates = React.useMemo(() => new Set(existingHolidayDates), [existingHolidayDates]);

  const reset = () => {
    setFetched(null);
    setSelected(new Set());
    setFetchState(null);
  };

  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open]);

  useEffect(() => {
    if (importState.ok) router.refresh();
  }, [importState.ok, router]);

  const countries = React.useMemo(
    () =>
      [...COUNTRIES].sort((a, b) => {
        const an = locale.startsWith("fr") ? a.fr : a.en;
        const bn = locale.startsWith("fr") ? b.fr : b.en;
        return an.localeCompare(bn, locale);
      }),
    [locale],
  );

  const countryLabel = React.useCallback(
    (code: string) => {
      const entry = COUNTRIES.find((c) => c.code === code.toUpperCase());
      if (!entry) return code.toUpperCase();
      return locale.startsWith("fr") ? entry.fr : entry.en;
    },
    [locale],
  );

  async function handleFetch() {
    setFetching(true);
    setFetchState(null);
    try {
      const result = await fetchNagerHolidaysAction(countryCode, Number(year));
      setFetchState(result);
      if (result.ok && result.holidays) {
        setFetched(result.holidays);
        setSelected(new Set(defaultSelectedDates(result.holidays)));
      }
    } finally {
      setFetching(false);
    }
  }

  const selectedCount = selected.size;
  const existingCount = fetched ? [...selected].filter((d) => existingDates.has(d)).length : 0;
  const newCount = fetched ? selectedCount - existingCount : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CloudDownload className="size-4" />
        {t("trigger")}
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {!fetched ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("country")} required id="importCountry">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger id="importCountry" className="w-full">
                    <SelectValue placeholder={t("countryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {locale.startsWith("fr") ? c.fr : c.en} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("year")} required id="importYear">
                <Input
                  id="importYear"
                  type="number"
                  min={MIN_IMPORT_YEAR}
                  max={MAX_IMPORT_YEAR}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  required
                />
              </Field>
            </div>
            {translateError(fetchState) ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {translateError(fetchState)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" type="button">
                  {tCommon("cancel")}
                </Button>
              </DialogClose>
              <Button onClick={handleFetch} disabled={fetching || !countryCode || !year}>
                <Globe2 className="size-4" />
                {fetching ? t("fetching") : t("fetch")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {importState.ok && importState.result ? (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-foreground">{t("importCompleted")}</p>
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t("countryLabel")}</span>{" "}
                    <span className="font-medium text-foreground">
                      {countryLabel(importState.result.countryCode)}
                    </span>
                    {" · "}
                    <span className="text-muted-foreground">{t("yearLabel")}</span>{" "}
                    <span className="font-medium text-foreground">{importState.result.year}</span>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <SummaryRow label={t("fetched")} value={importState.result.fetched} />
                  <SummaryRow label={t("selected")} value={importState.result.selected} />
                  <SummaryRow label={t("created")} value={importState.result.created} strong />
                  <SummaryRow label={t("existing")} value={importState.result.existing} />
                  <SummaryRow label={t("skipped")} value={importState.result.skipped} />
                  <SummaryRow label={t("failed")} value={0} />
                </div>
                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>{tCommon("close")}</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t("previewTitle", { country: countryLabel(countryCode), year })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("returnedCount", { count: fetched.length })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(fetched.map((h) => h.date)))}>
                      {t("selectAll")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                      {t("deselectAll")}
                    </Button>
                  </div>
                </div>

                {translateError(importState) ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {translateError(importState)}
                  </p>
                ) : null}

                <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left font-medium" />
                        <th className="px-3 py-2 text-left font-medium">{t("date")}</th>
                        <th className="px-3 py-2 text-left font-medium">{t("holiday")}</th>
                        <th className="px-3 py-2 text-left font-medium">{t("type")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("national")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fetched.map((h) => {
                        const checked = selected.has(h.date);
                        return (
                          <tr
                            key={h.date}
                            className={checked ? "border-t border-border bg-muted/30" : "border-t border-border"}
                          >
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const copy = new Set(selected);
                                  if (next) copy.add(h.date);
                                  else copy.delete(h.date);
                                  setSelected(copy);
                                }}
                                aria-label={h.name}
                              />
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(`${h.date}T00:00:00`).toLocaleDateString(locale, {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td className="px-3 py-2 font-medium text-foreground">{h.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{h.types.join(", ") || "—"}</td>
                            <td className="px-3 py-2 text-right">
                              {isNationalOrPublic(h) ? (
                                <Badge variant={h.global ? "success" : "neutral"}>{t("yes")}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border border-border px-4 py-3">
                  <div className="space-y-1">
                    <SummaryRow label={t("fetched")} value={fetched.length} />
                    <SummaryRow label={t("selected")} value={selectedCount} />
                    <SummaryRow label={t("alreadyExisting")} value={existingCount} />
                    <SummaryRow label={t("new")} value={newCount} strong />
                  </div>
                </div>

                <form action={formAction}>
                  <input type="hidden" name="countryCode" value={countryCode} />
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="selectedDates" value={JSON.stringify([...selected])} />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" type="button" onClick={handleFetch} disabled={fetching}>
                      <RefreshCw className={fetching ? "size-4 animate-spin" : "size-4"} />
                      {t("fetchAgain")}
                    </Button>
                    <DialogClose asChild>
                      <Button variant="ghost" type="button">
                        {tCommon("cancel")}
                      </Button>
                    </DialogClose>
                    <Button type="submit" disabled={selectedCount === 0}>
                      {t("importSelected", { count: selectedCount })}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
