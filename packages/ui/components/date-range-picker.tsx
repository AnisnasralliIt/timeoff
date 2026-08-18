"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { CalendarMonth } from "./calendar-month";
import {
  monthGrid,
  toISODate,
  fromISODate,
  addDays,
  localeMonthLabel,
  localeWeekdays,
  type ISODate,
} from "../lib/dates";

export interface DateRange {
  from: ISODate | null;
  to: ISODate | null;
}

export interface DateRangePickerProps {
  mode?: "single" | "range";
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  minDate?: ISODate;
  maxDate?: ISODate;
  placeholder?: string;
  className?: string;
  /** BCP-47 locale string (e.g. "en", "fr"). When provided, month and weekday
   *  labels are rendered in that locale. */
  locale?: string;
  /** Hint shown at the bottom of the range picker (e.g. "Pick a start date"). */
  rangeHint?: string;
  /** Label shown when a range start is selected (e.g. "From {date}"). */
  rangeFromLabel?: (date: string) => string;
  /** Label for the "Reset" button. */
  resetLabel?: string;
}

function dateLabel(r: DateRange): string {
  if (!r.from) return "";
  if (r.to && r.to !== r.from) return `${r.from} → ${r.to}`;
  return r.from;
}

/**
 * Date range picker. Range selection follows the "click start, click end"
 * flow with the start sticky until the end is chosen. Single mode behaves
 * like a normal date input.
 */
export function DateRangePicker({
  mode = "range",
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Pick dates",
  className,
  locale,
  rangeHint = "Pick a start date",
  rangeFromLabel = (date) => `From ${date}`,
  resetLabel = "Reset",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState(() => {
    const base = value?.from ? fromISODate(value.from) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() + 1 };
  });
  const [hover, setHover] = React.useState<ISODate | null>(null);

  const handleSelect = (iso: ISODate) => {
    if (mode === "single") {
      onChange?.({ from: iso, to: iso });
      setOpen(false);
      return;
    }
    const current = value ?? { from: null, to: null };
    if (!current.from || (current.to && current.to !== current.from)) {
      onChange?.({ from: iso, to: iso });
    } else if (iso < current.from) {
      onChange?.({ from: iso, to: current.from });
    } else {
      onChange?.({ from: current.from, to: iso });
    }
  };

  const shift = (delta: number) => {
    const d = new Date(view.year, view.month - 1 + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() + 1 });
  };

  const isSingleDaySelection = Boolean(
    value?.from && value?.to && value.from === value.to
  );
  const effectiveEnd = isSingleDaySelection
    ? (hover ?? value?.to)
    : (value?.to ?? hover);
  const rangeStart = value?.from ?? null;
  const showTwo = mode === "range";

  const canPrev = (() => {
    if (!minDate) return true;
    const firstOfView = new Date(view.year, view.month - 1, 1);
    return firstOfView > fromISODate(minDate);
  })();
  const canNext = (() => {
    if (!maxDate) return true;
    const lastOfView = new Date(view.year, view.month, 0);
    const secondMonth = addDays(lastOfView, 31);
    return secondMonth < fromISODate(maxDate);
  })();

  const disabledDates = React.useMemo(() => {
    const set = new Set<ISODate>();
    if (minDate) {
      let d = fromISODate("1900-01-01");
      const min = fromISODate(minDate);
      while (d < min) {
        set.add(toISODate(d));
        d = addDays(d, 1);
      }
    }
    if (maxDate) {
      let d = addDays(fromISODate(maxDate), 1);
      const horizon = addDays(d, 800);
      while (d <= horizon) {
        set.add(toISODate(d));
        d = addDays(d, 1);
      }
    }
    return set;
  }, [minDate, maxDate]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start font-normal",
            !value?.from && "text-muted-foreground",
            className
          )}
        >
          <CalendarDays className="mr-1 opacity-60" />
          {value?.from ? dateLabel(value) : placeholder}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shift(-1)}
                disabled={!canPrev}
                aria-label="Previous month"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => shift(1)}
                disabled={!canNext}
                aria-label="Next month"
              >
                <ChevronRight />
              </Button>
            </div>
            <div
              className={cn(
                "flex gap-4",
                showTwo && "grid grid-cols-1 gap-2 sm:grid-cols-2"
              )}
            >
              <CalendarMonth
                cells={monthGrid(view.year, view.month).cells}
                monthLabel={localeMonthLabel(view.year, view.month, locale)}
                weekdayLabels={localeWeekdays(locale)}
                onSelect={handleSelect}
                rangeStart={rangeStart}
                rangeEnd={effectiveEnd}
                disabledDates={disabledDates}
                onHoverDate={(iso) =>
                  mode === "range" &&
                  value?.from &&
                  (!value.to || value.from === value.to) &&
                  setHover(iso)
                }
              />
              {showTwo ? (
                <CalendarMonth
                  cells={monthGrid(
                    view.month === 12 ? view.year + 1 : view.year,
                    view.month === 12 ? 1 : view.month + 1
                  ).cells}
                  monthLabel={localeMonthLabel(
                    view.month === 12 ? view.year + 1 : view.year,
                    view.month === 12 ? 1 : view.month + 1,
                    locale,
                  )}
                  weekdayLabels={localeWeekdays(locale)}
                  onSelect={handleSelect}
                  rangeStart={rangeStart}
                  rangeEnd={effectiveEnd}
                  disabledDates={disabledDates}
                  onHoverDate={(iso) =>
                    mode === "range" &&
                    value?.from &&
                    (!value.to || value.from === value.to) &&
                    setHover(iso)
                  }
                />
              ) : null}
            </div>
            {mode === "range" ? (
              <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                <span>
                  {rangeStart
                    ? rangeFromLabel(rangeStart)
                    : rangeHint}
                  {effectiveEnd ? ` · to ${effectiveEnd}` : ""}
                </span>
                {rangeStart && !value?.to ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onChange?.({ from: null, to: null })}
                  >
                    {resetLabel}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
