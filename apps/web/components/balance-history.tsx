"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Badge, Card, CardContent, cn, statusVariant, type BadgeProps } from "@timeoff/ui";
import type { BalanceHistoryYear } from "@/lib/services/leave";

function statusBadgeVariant(status: string): BadgeProps["variant"] {
  return statusVariant[status.toLowerCase()] ?? "neutral";
}

function formatDays(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatDay(locale: string, iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-sm", emphasis ? "font-semibold text-foreground" : "font-medium text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

export function BalanceHistory({
  years,
  carryOverLimit,
  yearLabel,
}: {
  years: BalanceHistoryYear[];
  carryOverLimit: number | null;
  yearLabel?: (periodStart: string) => string;
}) {
  const t = useTranslations("balanceHistory");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("status");
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);

  if (years.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const label = (periodStart: string) => yearLabel?.(periodStart) ?? periodStart.slice(0, 4);

  return (
    <div className="space-y-3">
      {years.map((year) => {
        const isOpen = open === year.periodStart;
        return (
          <Card key={year.periodStart}>
            <div className="flex items-center justify-between gap-3 p-5 pb-0">
              <div className="flex items-center gap-2">
                <p className="font-display text-base font-semibold leading-snug tracking-tight">{label(year.periodStart)}</p>
                {year.isCurrent ? <Badge variant="primary">{t("current")}</Badge> : null}
              </div>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : year.periodStart)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {isOpen ? t("hideDetails") : t("viewDetails")}
                <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
              </button>
            </div>
            <CardContent>
              {year.leaveTypes.map((lt) => (
                <div key={lt.leaveType} className="mt-3 first:mt-0">
                  {year.leaveTypes.length > 1 ? (
                    <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{lt.leaveType}</h4>
                  ) : null}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label={t("accrued")} value={formatDays(lt.accrued)} />
                    <Stat label={t("carriedOver")} value={formatDays(lt.carriedOver)} />
                    <Stat label={t("used")} value={formatDays(lt.used)} />
                    <Stat label={t("pending")} value={formatDays(lt.pending)} />
                    <Stat label={t("adjustment")} value={formatDays(lt.adjustment)} />
                    <Stat label={t("available")} value={formatDays(lt.available)} emphasis />
                  </dl>
                </div>
              ))}

              {isOpen ? (
                <div className="mt-4 space-y-4 border-t border-border pt-4">
                  {year.isCurrent && carryOverLimit !== null ? (
                    <p className="text-xs text-muted-foreground">{t("carryOverLimit", { count: carryOverLimit })}</p>
                  ) : null}
                  <div>
                    <h4 className="text-sm font-semibold">{t("leaveActivity", { year: label(year.periodStart) })}</h4>
                    {year.activity.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">{t("noActivity")}</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-border">
                        {year.activity.map((a, i) => (
                          <li key={i} className="flex items-center justify-between gap-4 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {formatDay(locale, a.startDate)} – {formatDay(locale, a.endDate)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {a.leaveType}
                                {a.reason ? ` · ${a.reason}` : ""}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="text-xs text-muted-foreground">
                                {tCommon("dayCount", { count: a.totalDays })}
                              </span>
                              <Badge variant={statusBadgeVariant(a.status)}>{tStatus(a.status)}</Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
