"use client";

import * as React from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Switch } from "@timeoff/ui";
import { updateAuthorisationPolicyAction, type ActionState } from "@/lib/actions/authorisations";
import { useServerError } from "@/lib/client-error";

export function AuthorisationPolicyForm({
  enabled,
  monthlyAllowance,
  minRequestHours,
  maxRequestHours,
  requestIncrementHours,
  carryOverEnabled,
  maxCarryOverHours,
  prorateFirstMonth,
  requiresApproval,
}: {
  enabled: boolean;
  monthlyAllowance: number;
  minRequestHours: number;
  maxRequestHours: number;
  requestIncrementHours: number;
  carryOverEnabled: boolean;
  maxCarryOverHours: number;
  prorateFirstMonth: boolean;
  requiresApproval: boolean;
}) {
  const t = useTranslations("authorisationsPolicy");
  const tCommon = useTranslations("common");
  const translateError = useServerError();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateAuthorisationPolicyAction,
    {},
  );
  const [form, setForm] = React.useState({
    enabled,
    monthlyAllowance,
    minRequestHours,
    maxRequestHours,
    requestIncrementHours,
    carryOverEnabled,
    maxCarryOverHours,
    prorateFirstMonth,
    requiresApproval,
  });

  React.useEffect(() => {
    if (state.ok && state.saved) {
      setForm({
        enabled: state.saved.enabled,
        monthlyAllowance: state.saved.monthlyAllowance,
        minRequestHours: state.saved.minRequestHours,
        maxRequestHours: state.saved.maxRequestHours,
        requestIncrementHours: state.saved.requestIncrementHours,
        carryOverEnabled: state.saved.carryOverEnabled,
        maxCarryOverHours: state.saved.maxCarryOverHours,
        prorateFirstMonth: state.saved.prorateFirstMonth,
        requiresApproval: state.saved.requiresApproval,
      });
    }
  }, [state]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form action={formAction} className="space-y-4">
      <label
        htmlFor="authorisationEnabled"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">{t("enabledLabel")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("enabledHint")}</span>
        </span>
        <Switch
          id="authorisationEnabled"
          checked={form.enabled}
          onCheckedChange={(value: boolean) => set("enabled", value)}
          aria-label={t("enabledLabel")}
        />
      </label>
      <input type="hidden" name="enabled" value={form.enabled ? "on" : "off"} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("monthlyAllowanceLabel")} hint={t("monthlyAllowanceHint")} id="authorisation-monthlyAllowance">
          <Input
            id="authorisation-monthlyAllowance"
            name="monthlyAllowance"
            type="number"
            step={0.5}
            min={0}
            value={form.monthlyAllowance}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("monthlyAllowance", Number(e.target.value))}
          />
        </Field>
        <Field label={t("maxCarryOverLabel")} hint={t("maxCarryOverHint")} id="authorisation-maxCarryOver">
          <Input
            id="authorisation-maxCarryOver"
            name="maxCarryOverHours"
            type="number"
            step={0.5}
            min={0}
            value={form.maxCarryOverHours}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("maxCarryOverHours", Number(e.target.value))}
          />
        </Field>
        <Field label={t("minHoursLabel")} hint={t("minHoursHint")} id="authorisation-minHours">
          <Input
            id="authorisation-minHours"
            name="minRequestHours"
            type="number"
            step={0.5}
            min={0}
            value={form.minRequestHours}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("minRequestHours", Number(e.target.value))}
          />
        </Field>
        <Field label={t("maxHoursLabel")} hint={t("maxHoursHint")} id="authorisation-maxHours">
          <Input
            id="authorisation-maxHours"
            name="maxRequestHours"
            type="number"
            step={0.5}
            min={0}
            value={form.maxRequestHours}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("maxRequestHours", Number(e.target.value))}
          />
        </Field>
        <Field label={t("incrementLabel")} hint={t("incrementHint")} id="authorisation-increment">
          <Input
            id="authorisation-increment"
            name="requestIncrementHours"
            type="number"
            step={0.5}
            min={0}
            value={form.requestIncrementHours}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("requestIncrementHours", Number(e.target.value))}
          />
        </Field>
      </div>

      <label
        htmlFor="authorisationCarryOverEnabled"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">{t("carryOverEnabledLabel")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("carryOverEnabledHint")}</span>
        </span>
        <Switch
          id="authorisationCarryOverEnabled"
          checked={form.carryOverEnabled}
          onCheckedChange={(value: boolean) => set("carryOverEnabled", value)}
          aria-label={t("carryOverEnabledLabel")}
        />
      </label>
      <input type="hidden" name="carryOverEnabled" value={form.carryOverEnabled ? "on" : "off"} />

      <label
        htmlFor="authorisationProrateJoiningMonth"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">{t("prorateJoiningLabel")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("prorateJoiningHint")}</span>
        </span>
        <Switch
          id="authorisationProrateJoiningMonth"
          checked={form.prorateFirstMonth}
          onCheckedChange={(value: boolean) => set("prorateFirstMonth", value)}
          aria-label={t("prorateJoiningLabel")}
        />
      </label>
      <input type="hidden" name="prorateFirstMonth" value={form.prorateFirstMonth ? "on" : "off"} />

      <label
        htmlFor="authorisationRequiresApproval"
        className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
      >
        <span>
          <span className="block text-sm font-medium text-foreground">{t("requiresApprovalLabel")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("requiresApprovalHint")}</span>
        </span>
        <Switch
          id="authorisationRequiresApproval"
          checked={form.requiresApproval}
          onCheckedChange={(value: boolean) => set("requiresApproval", value)}
          aria-label={t("requiresApprovalLabel")}
        />
      </label>
      <input type="hidden" name="requiresApproval" value={form.requiresApproval ? "on" : "off"} />

      {translateError(state) ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {translateError(state)}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("saving") : tCommon("save")}
        </Button>
      </div>
    </form>
  );
}
