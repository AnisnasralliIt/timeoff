"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCheck } from "lucide-react";
import { Button } from "@timeoff/ui";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import { useNotifLocalized } from "@/lib/notif-localized";

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(
  iso: string,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
  locale: string,
): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("days", { count: days });
  return new Date(iso).toLocaleDateString(locale);
}

function hrefFor(item: NotificationRow): string | null {
  if (item.entityType === "LeaveRequest" && item.entityId) return `/requests/${item.entityId}`;
  return null;
}

export function NotificationList({ items, unread }: { items: NotificationRow[]; unread: number }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");
  const tTime = useTranslations("timeAgo");
  const localize = useNotifLocalized();
  const [count, setCount] = React.useState(unread);

  const markRead = async (item: NotificationRow) => {
    if (item.readAt) return;
    setCount((c) => Math.max(0, c - 1));
    await markNotificationReadAction(item.id);
    router.refresh();
  };

  const markAll = async () => {
    await markAllNotificationsReadAction();
    setCount(0);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {count === 0 ? t("allCaughtUp") : t("unreadCount", { count })}
          </p>
        </div>
        {count > 0 ? (
          <Button variant="outline" size="sm" onClick={markAll}>
            <CheckCheck className="size-3.5" />
            {t("markAllAsRead")}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t("emptyDescription")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {items.map((item: (typeof items)[number]) => {
            const href = hrefFor(item);
            const localized = localize(item.title, item.body);
            const inner = (
              <div className="flex flex-1 items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={item.readAt ? "text-sm font-medium text-muted-foreground" : "text-sm font-semibold text-foreground"}>
                    {localized.title}
                  </p>
                  {localized.body ? <p className="mt-0.5 text-xs text-muted-foreground">{localized.body}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">{timeAgo(item.createdAt, tTime, locale)}</p>
                </div>
                {!item.readAt ? <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-label={tCommon("unread")} /> : null}
              </div>
            );
            return (
              <li key={item.id} className="flex items-center gap-3 px-5 py-4">
                {href ? (
                  <Link href={href} className="flex min-w-0 flex-1" onClick={() => void markRead(item)}>
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
                {!item.readAt ? (
                  <Button variant="ghost" size="sm" onClick={() => void markRead(item)}>
                    {t("markRead")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
