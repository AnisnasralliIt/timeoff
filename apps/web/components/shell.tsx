"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, Menu, Settings } from "lucide-react";
import {
  Avatar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
} from "@timeoff/ui";
import { LogoMark, Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { LocaleToggle } from "./locale-toggle";
import { navSections } from "./nav";
import { signOutAction } from "@/lib/actions/auth";

export interface ShellUser {
  id: string;
  email: string;
  name: string;
  role?: string;
  companyId?: string;
}

/** Role gates per nav minRole key. SUPER_ADMIN passes everything. */
const ROLE_GATES: Record<NonNullable<import("./nav").NavItem["minRole"]>, (role?: string) => boolean> = {
  approver: (role) => role === "MANAGER" || role === "HR" || role === "ADMIN" || role === "SUPER_ADMIN",
  insights: (role) => role === "EXECUTIVE" || role === "HR" || role === "ADMIN" || role === "SUPER_ADMIN",
  "people-ops": (role) => role === "HR" || role === "ADMIN" || role === "SUPER_ADMIN",
  "super-admin": (role) => role === "SUPER_ADMIN",
};

function roleAllowed(user: ShellUser, minRole: NonNullable<import("./nav").NavItem["minRole"]>): boolean {
  return ROLE_GATES[minRole](user.role);
}

export function Shell({
  user,
  notifications,
  children,
}: {
  user: ShellUser;
  notifications?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const tRole = useTranslations("roles");

  const roleLabel = user.role ? tRole(user.role) : "";

  const visibleSections = navSections
    .map((section: (typeof navSections)[number]) => ({
      ...section,
      items: section.items.filter(
        (item: (typeof section.items)[number]) => !item.minRole || roleAllowed(user, item.minRole),
      ),
    }))
    .filter((section: (typeof navSections)[number]) => section.items.length > 0);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <LogoMark />
        <Wordmark />
      </div>
      <Separator />
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label={tNav("aria.main")}>
        {visibleSections.map((section: (typeof visibleSections)[number]) => (
          <div key={section.titleKey}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {tNav(`sections.${section.titleKey}`)}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item: (typeof section.items)[number]) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary-subtle text-primary-subtle-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {tNav(`items.${item.labelKey}`)}
                      {item.badge ? (
                        <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-destructive text-[11px] font-semibold text-destructive-foreground">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Separator />
      <div className="flex items-center gap-2.5 p-3">
        <Avatar name={user.name} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("accountMenu")}>
              <span className="text-muted-foreground">…</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Settings className="size-4" />
              {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive asChild>
              <form action={signOutAction}>
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut className="size-4" />
                  {t("signOut")}
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-card lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label={t("closeMenu")}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-sand-950/50"
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-lg animate-in slide-in-from-left">
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={t("openMenu")}
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <span className="lg:hidden">
              <LogoMark />
            </span>
          </div>
          <div className="flex items-center gap-1">
            <LocaleToggle />
            <ThemeToggle />
            {notifications}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
