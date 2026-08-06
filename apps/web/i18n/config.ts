export const LOCALE_COOKIE = "timeoff-locale";

export const defaultLocale = "en";

export const locales = ["en", "fr"] as const;

export type AppLocale = (typeof locales)[number];

export function isLocale(value: string | undefined): value is AppLocale {
  return value === "en" || value === "fr";
}
