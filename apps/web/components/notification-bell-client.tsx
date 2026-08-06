"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timeoff/ui";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import { useNotifLocalized } from "@/lib/notif-localized";

export interface BellItem {
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

export function NotificationBellClient({ unread, items }: { unread: number; items: BellItem[] }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("notifications");
  const tTime = useTranslations("timeAgo");
  const localize = useNotifLocalized();
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState(unread);

  const openItem = async (item: BellItem) => {
    if (!item.readAt) {
      setCount((c) => Math.max(0, c - 1));
      await markNotificationReadAction(item.id);
    }
    setOpen(false);
    if (item.entityType === "LeaveRequest" && item.entityId) router.push(`/requests/${item.entityId}`);
    else router.push("/notifications");
    router.refresh();
  };

  const markAll = async () => {
    setOpen(false);
    await markAllNotificationsReadAction();
    setCount(0);
    router.refresh();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count ? t("bellAriaUnread", { count }) : t("bellAria")}>
          <Bell />
          {count > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="px-0 py-0">{t("title")}</DropdownMenuLabel>
          {count > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" />
              {t("markAllRead")}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">{t("nothingHere")}</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <DropdownMenuItem
              key={item.id}
              asChild
              onSelect={(event) => {
                event.preventDefault();
                void openItem(item);
              }}
            >
              <button type="button" className="flex w-full flex-col items-start gap-0.5 px-2 py-2 text-left">
                {(() => {
                  const localized = localize(item.title, item.body);
                  return (
                    <>
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className={item.readAt ? "truncate text-sm font-medium text-muted-foreground" : "truncate text-sm font-medium"}>
                          {localized.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.createdAt, tTime, locale)}</span>
                      </span>
                      {localized.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{localized.body}</span> : null}
                    </>
                  );
                })()}
              </button>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={() => setOpen(false)}>
          <Link href="/notifications" className="justify-center text-sm font-medium text-primary">
            {t("viewAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
