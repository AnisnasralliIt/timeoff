"use client";

import { useTranslations } from "next-intl";
import type { ServerErrorShape } from "@/lib/errors";

/**
 * Client hook that renders a server-action error state in the active locale.
 * Prefers the localized `errorCode`, falls back to the raw message.
 */
export function useServerError() {
  const t = useTranslations("errors");
  return (state: ServerErrorShape | null | undefined): string | null => {
    if (!state) return null;
    if (state.errorCode) {
      return t(
        state.errorCode,
        state.errorValues as Record<string, string | number>,
      );
    }
    return state.error ?? null;
  };
}
