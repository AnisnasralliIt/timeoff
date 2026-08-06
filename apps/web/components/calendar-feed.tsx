"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Copy, RefreshCw, Check } from "lucide-react";
import { Button } from "@timeoff/ui";
import {
  getCalendarFeedUrl,
  regenerateCalendarFeedAction,
} from "@/lib/actions/integrations";
import { useServerError } from "@/lib/client-error";

export function CalendarFeedCard() {
  const t = useTranslations("feed");
  const translateError = useServerError();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCalendarFeedUrl().then((state) => {
      setFeedUrl(state.url ?? null);
      setError(state.url ? null : translateError(state));
      setLoading(false);
    });
  }, [translateError]);

  const fullUrl = feedUrl ? `${window.location.origin}${feedUrl}` : null;

  async function copy() {
    if (!fullUrl) return;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function rotate() {
    setRotating(true);
    const state = await regenerateCalendarFeedAction();
    setFeedUrl(state.url ?? null);
    setError(state.url ? null : translateError(state));
    setRotating(false);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="font-display text-base font-semibold text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("description")}
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : fullUrl ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground">
              {fullUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("linkSecurity")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={rotate}
            disabled={rotating}
          >
            <RefreshCw className={`size-4 ${rotating ? "animate-spin" : ""}`} />
            {t("rotate")}
          </Button>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("noFeed")}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarPlus className="size-4" />
        {t("allDayEvents")}
      </div>
    </div>
  );
}
