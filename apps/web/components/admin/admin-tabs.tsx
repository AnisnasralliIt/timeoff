"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users, Building2, Briefcase, Wallet, Gauge, Settings, History } from "lucide-react";
import { cn } from "@timeoff/ui";
import type { SessionUser } from "@/lib/session";

const tabs = [
  { href: "/admin", key: "overview", icon: Gauge, minRole: ["HR", "ADMIN"] },
  { href: "/admin/users", key: "users", icon: Users, minRole: ["HR", "ADMIN"] },
  { href: "/admin/departments", key: "departments", icon: Building2, minRole: ["HR", "ADMIN"] },
  { href: "/admin/leave-types", key: "leaveTypes", icon: Briefcase, minRole: ["HR", "ADMIN"] },
  { href: "/admin/balances", key: "balances", icon: Wallet, minRole: ["HR", "ADMIN"] },
  { href: "/admin/audit-log", key: "auditLog", icon: History, minRole: ["MANAGER", "HR", "ADMIN"] },
  { href: "/admin/settings", key: "settings", icon: Settings, minRole: ["HR", "ADMIN"] },
] as const;

export function AdminTabs({ user }: { user?: SessionUser }) {
  const t = useTranslations("admin.tabs");
  const pathname = usePathname();
  const role = user?.role;
  const visible =
    role === "SUPER_ADMIN"
      ? tabs
      : tabs.filter((tab: (typeof tabs)[number]) => (role ? (tab.minRole as readonly string[]).includes(role) : false));
  return (
    <nav aria-label={t("ariaSections")} className="flex flex-wrap gap-1 border-b border-border">
      {visible.map((tab: (typeof tabs)[number]) => {
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
