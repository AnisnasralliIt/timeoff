"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { WEEKDAYS, type ISODate } from "../lib/dates";

export interface CalendarMonthProps {
  /** Monday-first grid cells (from monthGrid). */
  cells: (ISODate | null)[];
  monthLabel: string;
  /** Monday-first weekday header labels; defaults to English abbreviations. */
  weekdayLabels?: string[];
  selected?: ISODate | null;
  rangeStart?: ISODate | null;
  rangeEnd?: ISODate | null;
  onSelect?: (date: ISODate) => void;
  onHoverDate?: (date: ISODate | null) => void;
  /** Extra markers per day, e.g. leave-type color dots. */
  dayMarkers?: Record<ISODate, { tone: string; label: string }[]>;
  disabledDates?: Set<ISODate>;
  className?: string;
}

/** Presentational month grid used by the date picker and team calendar. */
export function CalendarMonth({
  cells,
  monthLabel,
  weekdayLabels = WEEKDAYS,
  selected,
  rangeStart,
  rangeEnd,
  onSelect,
  onHoverDate,
  dayMarkers,
  disabledDates,
  className,
}: CalendarMonthProps) {
  const inRange = (iso: ISODate) => {
    if (!rangeStart || !rangeEnd) return false;
    return iso >= rangeStart && iso <= rangeEnd;
  };
  const isStart = (iso: ISODate) => rangeStart === iso;
  const isEnd = (iso: ISODate) => rangeEnd === iso;

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1.5 flex justify-center">
        <p className="text-sm font-medium text-foreground">{monthLabel}</p>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            className="py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`pad-${i}`} className="size-8" />;
          const disabled = disabledDates?.has(iso);
          const marker = dayMarkers?.[iso];
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled || !onSelect}
              onClick={() => onSelect?.(iso)}
              onMouseEnter={() => onHoverDate?.(iso)}
              onMouseLeave={() => onHoverDate?.(null)}
              aria-label={iso}
              className={cn(
                "relative mx-auto flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                inRange(iso) && "bg-primary-subtle text-primary-subtle-foreground",
                isStart(iso) &&
                  "rounded-none rounded-l-md bg-primary text-primary-foreground",
                isEnd(iso) &&
                  "rounded-none rounded-r-md bg-primary text-primary-foreground",
                selected === iso &&
                  !isStart(iso) &&
                  !isEnd(iso) &&
                  "bg-primary text-primary-foreground",
                !inRange(iso) &&
                  !selected &&
                  !isStart(iso) &&
                  !isEnd(iso) &&
                  "hover:bg-accent",
                disabled && "cursor-not-allowed opacity-30 hover:bg-transparent",
                !onSelect && "cursor-default"
              )}
            >
              {Number(iso.slice(-2))}
              {marker && marker.length > 0 ? (
                <span className="absolute bottom-0.5 flex gap-0.5">
                  {marker.slice(0, 3).map((m, j) => (
                    <span
                      key={j}
                      className="size-1 rounded-full"
                      style={{ background: m.tone }}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
