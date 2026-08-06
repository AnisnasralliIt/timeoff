"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users, Building2, Briefcase, Wallet, Gauge } from "lucide-react";
import { cn } from "@timeoff/ui";

const tabs = [
  { href: "/admin", key: "overview", icon: Gauge },
  { href: "/admin/users", key: "users", icon: Users },
  { href: "/admin/departments", key: "departments", icon: Building2 },
  { href: "/admin/leave-types", key: "leaveTypes", icon: Briefcase },
  { href: "/admin/balances", key: "balances", icon: Wallet },
] as const;

export function AdminTabs() {
  const t = useTranslations("admin.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("ariaSections")} className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const label = t(tab.key);
        const active =
          tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
