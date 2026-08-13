"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button, Field, Input } from "@timeoff/ui";
import { googleSignInAction, loginAction, type LoginState } from "@/lib/actions/auth";
import { useServerError } from "@/lib/client-error";

export function LoginForm({ showGoogle }: { showGoogle: boolean }) {
  const t = useTranslations("login");
  const translateError = useServerError();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label={t("email")} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          required
        />
      </Field>

      <Field label={t("password")} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </Field>

      {translateError(state) ? (
        <p role="alert" className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {translateError(state)}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? t("signingIn") : t("signIn")}
      </Button>

      {showGoogle ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={() => void googleSignInAction()}
          >
            {t("continueGoogle")}
          </Button>
        </>
      ) : null}
    </form>
  );
}
