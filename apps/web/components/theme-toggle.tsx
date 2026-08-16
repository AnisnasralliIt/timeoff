"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import { Button } from "@timeoff/ui";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("theme");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Before mount the theme is unknown (SSR cannot read the stored theme), so a
  // theme-independent placeholder is rendered. It is byte-for-byte identical on
  // the server and the first client render, then swapped for the real theme
  // once mounted. This avoids the icon/aria-label hydration mismatch.
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label={t("toDark")}>
        <Moon />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? t("toLight") : t("toDark")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
