"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button, toast } from "@timeoff/ui";
import { useServerError } from "@/lib/client-error";
import type { RequestStatus } from "@/lib/calendar-shared";

export interface ExportFilters {
  from: string;
  to: string;
  departmentId?: string;
  leaveTypeId?: string;
  statuses: RequestStatus[];
}

interface ExportButtonProps {
  /** "filters" = current calendar view; "all" = everything the actor can see. */
  variant?: "filters" | "all";
  filters?: ExportFilters;
  disabled?: boolean;
  className?: string;
}

/**
 * Kicks off a scoped, audit-logged Excel export via POST /api/export and
 * downloads the returned .xlsx. Shared by the team calendar and the workforce
 * overview (same endpoint, same server-side scoping).
 */
export function ExportButton({
  variant = "filters",
  filters,
  disabled,
  className,
}: ExportButtonProps) {
  const t = useTranslations("export");
  const tToast = useTranslations("toasts");
  const translateError = useServerError();
  const [busy, setBusy] = React.useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { scope: variant === "all" ? "all" : "filtered" };
      if (variant === "filters" && filters) {
        body.from = filters.from;
        body.to = filters.to;
        if (filters.departmentId) body.departmentId = filters.departmentId;
        if (filters.leaveTypeId) body.leaveTypeId = filters.leaveTypeId;
        body.statuses = filters.statuses;
      }
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let state: { errorCode?: string; error?: string } = { errorCode: "exportFailed" };
        try {
          const json = await res.json();
          if (json?.errorCode || json?.error) state = json;
        } catch {
          // fall back to the generic failure message
        }
        const message = translateError(state);
        if (message) toast.error(message);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? "timeoff-export.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(tToast("exportSuccess"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={run}
      disabled={disabled || busy}
    >
      <Download className={busy ? "animate-pulse" : undefined} />
      {busy ? t("exporting") : t("button")}
    </Button>
  );
}
