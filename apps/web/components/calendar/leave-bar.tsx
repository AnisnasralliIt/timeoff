"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Tooltip, TooltipContent, TooltipTrigger, statusVariant, cn } from "@timeoff/ui";
import { isHalfDay, type BarSegment, type CalendarLeave } from "@/lib/calendar-shared";
import { resolveLeaveTypeName } from "@/lib/leave-type-name";

interface LeaveBarProps {
  leave: CalendarLeave;
  segs: BarSegment[];
  /** "pct" = column share of `colCount` (month grid); "px" = fixed day width. */
  unit: "pct" | "px";
  dayWidth?: number;
  colCount?: number;
  top?: number;
  height?: number;
  showLabel?: boolean;
}

/** A full-duration leave bar with half-day edge segments + hover details. */
export function LeaveBar({
  leave,
  segs,
  unit,
  dayWidth = 28,
  colCount = 7,
  top = 0,
  height = 18,
  showLabel = false,
}: LeaveBarProps) {
  const t = useTranslations("calendar");
  const tDay = useTranslations("dayPart");
  const locale = useLocale();
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const span = last.end - first.start + 1;
  const style =
    unit === "pct"
      ? { left: `${(first.start / colCount) * 100}%`, width: `${(span / colCount) * 100}%`, top, height }
      : { left: first.start * dayWidth, width: span * dayWidth, top, height };

  const pending = leave.status === "PENDING";
  const fullSpan =
    leave.startDate === leave.endDate
      ? leave.startDate
      : `${leave.startDate} – ${leave.endDate}`;

  const halfNotes = [
    isHalfDay(leave.startDayPart) ? tDay(leave.startDayPart) : null,
    isHalfDay(leave.endDayPart) ? tDay(leave.endDayPart) : null,
  ].filter(Boolean);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/requests/${leave.id}`}
          aria-label={`${leave.userName}: ${fullSpan}`}
          className="absolute block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={style}
        >
          <span
            className={cn(
              "relative flex h-full w-full items-end overflow-hidden rounded-sm border",
              pending && "opacity-70"
            )}
            style={{ borderColor: pending ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.45)" }}
          >
            {segs.map((seg: BarSegment, i: number) => (
              <span
                key={i}
                className={cn("flex-1", seg.half ? "h-1/2" : "h-full")}
                style={{ background: leave.leaveTypeColor }}
              />
            ))}
            {pending ? (
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.25) 4px 8px)",
                }}
                aria-hidden
              />
            ) : null}
          </span>
          {showLabel && span * dayWidth >= 52 ? (
            <span className="absolute inset-y-0 left-1 flex items-center text-[10px] font-medium leading-none text-white drop-shadow-sm">
              <span className="truncate">{leave.userName}</span>
            </span>
          ) : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-72 border-border bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <div className="space-y-1.5 text-xs">
          <p className="text-sm font-medium text-foreground">{leave.userName}</p>
          <p className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: leave.leaveTypeColor }} aria-hidden />
            <span className="text-foreground">{resolveLeaveTypeName({ name: leave.leaveTypeName, nameEn: leave.leaveTypeNameEn, nameFr: leave.leaveTypeNameFr }, locale)}</span>
            <span className="text-muted-foreground">· {leave.departmentName}</span>
          </p>
          <p className="text-muted-foreground">{fullSpan}</p>
          <p className="text-muted-foreground">
            {t("workingDays", { count: leave.totalDays })}
            {halfNotes.length > 0 ? ` · ${halfNotes.join(" · ")}` : ""}
          </p>
          <span className="pt-0.5">
            <Badge variant={statusVariant[leave.status.toLowerCase()] ?? "neutral"}>
              {leave.status === "PENDING" ? t("pendingBadge") : t("approvedBadge")}
            </Badge>
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
