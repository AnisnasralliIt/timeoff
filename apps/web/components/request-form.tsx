"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { computeLeaveDays, todayISO } from "@timeoff/domain";
import { toast } from "@timeoff/ui";
import { Button } from "@timeoff/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@timeoff/ui";
import { DateRangePicker, type DateRange } from "@timeoff/ui";
import { Field } from "@timeoff/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";
import { Textarea } from "@timeoff/ui";
import { CalendarClock } from "lucide-react";
import { createLeaveRequestAction, type CreateRequestState } from "@/lib/actions/leave";
import { AttachmentUpload } from "@/components/attachment-upload";
import { useServerError } from "@/lib/client-error";

interface LeaveTypeOption {
  id: string;
  name: string;
  isPaid: boolean;
  requiresApproval: boolean;
  requiresAttachment: boolean;
}

interface RequestFormProps {
  leaveTypes: LeaveTypeOption[];
  balanceByType: Map<string, number>;
  holidayDates: Set<string>;
  employmentStartDate: string | null;
  countWeekendsWithinSpan: boolean;
  extendWeekendAfterFriday: boolean;
}

const DAY_PART_OPTIONS = ["FULL", "FIRST_HALF", "SECOND_HALF"] as const;

export function RequestForm({
  leaveTypes,
  balanceByType,
  holidayDates,
  employmentStartDate,
  countWeekendsWithinSpan,
  extendWeekendAfterFriday,
}: RequestFormProps) {
  const router = useRouter();
  const t = useTranslations("requestForm");
  const tDayPart = useTranslations("dayPart");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [leaveTypeId, setLeaveTypeId] = React.useState<string>(leaveTypes[0]?.id ?? "");
  const [range, setRange] = React.useState<DateRange>({ from: null, to: null });
  const [startDayPart, setStartDayPart] = React.useState<string>("FULL");
  const [endDayPart, setEndDayPart] = React.useState<string>("FULL");
  const [reason, setReason] = React.useState("");
  const [attachmentId, setAttachmentId] = React.useState<string | null>(null);
  const [state, formAction, pending] = React.useActionState<
    CreateRequestState,
    FormData
  >(createLeaveRequestAction, {});

  const minDate = employmentStartDate ?? todayISO();

  const preview = React.useMemo(() => {
    if (!range.from || !range.to) return null;
    try {
      return computeLeaveDays(
        {
          startDate: range.from,
          endDate: range.to,
          startDayPart: startDayPart as "FULL" | "FIRST_HALF" | "SECOND_HALF",
          endDayPart: endDayPart as "FULL" | "FIRST_HALF" | "SECOND_HALF",
        },
        { holidays: holidayDates, countWeekendsWithinSpan, extendWeekendAfterFriday },
      );
    } catch {
      return null;
    }
  }, [range, startDayPart, endDayPart, holidayDates, countWeekendsWithinSpan, extendWeekendAfterFriday]);

  // Toggle-2 clarity: when the Friday-extension applied, totalDays exceeds the
  // actually-selected day count, so both numbers must be shown.
  const selectedDayCount = preview
    ? preview.days.reduce((sum, day) => sum + (day.dayPart === "FULL" ? 1 : 0.5), 0)
    : 0;
  const weekendExtended = Boolean(preview && preview.totalDays > selectedDayCount);

  React.useEffect(() => {
    if (state.requestId) {
      toast.success(tToast("requestSubmitted"));
      router.push("/requests");
    } else {
      const error = translateError(state);
      if (error) toast.error(error);
    }
  }, [state, router, tToast, translateError]);

  const selectedBalance =
    leaveTypeId && balanceByType.has(leaveTypeId)
      ? balanceByType.get(leaveTypeId)!
      : null;
  const selectedType = leaveTypes.find((t: LeaveTypeOption) => t.id === leaveTypeId);
  const selectedRequiresAttachment = selectedType?.requiresAttachment ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <Field label={t("leaveType")} required id="leaveTypeId">
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger id="leaveTypeId">
                <SelectValue placeholder={t("chooseLeaveType")} />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((type: LeaveTypeOption) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBalance !== null ? (
              <p className="text-xs text-muted-foreground">
                {t("availableBalance", { count: selectedBalance })}
                {selectedBalance <= 5 ? t("gettingLow") : ""}
              </p>
            ) : null}
          </Field>

          <Field label={t("dates")} required id="startDate">
            <DateRangePicker
              value={range}
              onChange={setRange}
              minDate={minDate}
              className="w-full"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("startDay")} required id="startDayPart">
              <Select value={startDayPart} onValueChange={setStartDayPart}>
                <SelectTrigger id="startDayPart">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_PART_OPTIONS.map((value: (typeof DAY_PART_OPTIONS)[number]) => (
                    <SelectItem key={value} value={value}>
                      {tDayPart(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("endDay")} required id="endDayPart">
              <Select value={endDayPart} onValueChange={setEndDayPart}>
                <SelectTrigger id="endDayPart">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_PART_OPTIONS.map((value: (typeof DAY_PART_OPTIONS)[number]) => (
                    <SelectItem key={value} value={value}>
                      {tDayPart(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={t("reason")} id="reason" hint={t("reasonHint")}>
            <Textarea
              id="reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </Field>

          <Field
            label={t("attachment")}
            id="attachment"
            hint={
              selectedRequiresAttachment
                ? t("attachmentRequiredHint")
                : t("attachmentOptionalHint")
            }
          >
            <AttachmentUpload
              value={attachmentId}
              onChange={setAttachmentId}
              requiresAttachment={selectedRequiresAttachment}
              required={selectedRequiresAttachment}
            />
          </Field>

          <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
          <input type="hidden" name="startDate" value={range.from ?? ""} />
          <input type="hidden" name="endDate" value={range.to ?? ""} />
          <input type="hidden" name="startDayPart" value={startDayPart} />
          <input type="hidden" name="endDayPart" value={endDayPart} />
          <input type="hidden" name="attachmentId" value={attachmentId ?? ""} />

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              {preview ? (
                <div>
                  <p className="text-sm">
                    <span className="font-display text-lg font-semibold text-foreground">
                      {preview.totalDays}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {t("workingDays", { count: preview.totalDays })}
                    </span>
                  </p>
                  {weekendExtended ? (
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {t("selectedDays", { count: selectedDayCount })} ·{" "}
                      {t("deductedDays", { count: preview.totalDays })}{" "}
                      <span className="text-foreground">
                        {t("includesFollowingWeekend")}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("pickDateRange")}
                </p>
              )}
              {translateError(state) ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {translateError(state)}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={pending || !range.from || !range.to || (selectedRequiresAttachment && !attachmentId)}
            >
              {pending ? t("submitting") : t("submitRequest")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
