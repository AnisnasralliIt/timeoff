"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@timeoff/ui";
import { useServerError } from "@/lib/client-error";

interface AttachmentUploadProps {
  /** Currently staged attachment id (controlled). */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Uploads as a MEDICAL_CERTIFICATE when the leave type requires it. */
  requiresAttachment?: boolean;
  required?: boolean;
}

/**
 * Staged file upload for a leave request. Uploads to /api/attachments, which
 * encrypts the blob and returns an id that gets bound to the request on submit.
 */
export function AttachmentUpload({
  value,
  onChange,
  requiresAttachment,
  required,
}: AttachmentUploadProps) {
  const t = useTranslations("attachments");
  const translateError = useServerError();
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError(t("tooBig"));
      return;
    }
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      setError(t("typeNotAllowed"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", requiresAttachment ? "MEDICAL_CERTIFICATE" : "GENERAL");
      const res = await fetch("/api/attachments", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(translateError(data) ?? t("uploadFailed"));
        return;
      }
      setFileName(data.attachment.fileName ?? file.name);
      onChange(data.attachment.id);
    } catch {
      setError(t("uploadFailedTryAgain"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const clear = () => {
    setFileName(null);
    setError(null);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      {value && fileName ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <Check className="size-4 shrink-0 text-primary" />
            <span className="truncate">{fileName}</span>
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={clear} aria-label={t("removeAria")}>
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground transition-colors hover:bg-accent">
          <Paperclip className="size-4" />
          {uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              {t("uploading")}
            </span>
          ) : (
            t("chooseFile")
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="sr-only"
            disabled={uploading}
            required={required && !value}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
