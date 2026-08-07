"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Dices, UserPlus } from "lucide-react";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@timeoff/ui";
import { useState } from "react";
import { createUserAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

type Dept = { id: string; name: string };
type Manager = { id: string; name: string };

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("adminDialogs.createUser");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? t("creating") : t("createUser")}
    </Button>
  );
}

const GENERATED_CHARSET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";

function generatePassword(length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => GENERATED_CHARSET[b % GENERATED_CHARSET.length]).join("");
}

export function CreateUserDialog({
  departments,
  managers,
  canGrantAdmin,
}: {
  departments: Dept[];
  managers: Manager[];
  canGrantAdmin: boolean;
}) {
  const t = useTranslations("adminDialogs.createUser");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("roles");
  const tEmployment = useTranslations("employment");
  const translateError = useServerError();
  const [state, formAction] = useActionState(createUserAction, {});
  const [role, setRole] = useState("EMPLOYEE");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [managerId, setManagerId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="departmentId" value={departmentId} />
          <input type="hidden" name="managerId" value={managerId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fullName")} required id="name">
              <Input id="name" name="name" placeholder="Ada Lovelace" required />
            </Field>
            <Field label={t("email")} required id="email">
              <Input id="email" name="email" type="email" placeholder="ada@acme.dev" required />
            </Field>
            <Field label={t("role")} required id="role">
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMPLOYEE">{tRole("EMPLOYEE")}</SelectItem>
                  <SelectItem value="MANAGER">{tRole("MANAGER")}</SelectItem>
                  <SelectItem value="HR">{tRole("HR")}</SelectItem>
                  {canGrantAdmin ? <SelectItem value="ADMIN">{tRole("ADMIN")}</SelectItem> : null}
                  <SelectItem value="EXECUTIVE">{tRole("EXECUTIVE")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("department")} required id="departmentId">
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="departmentId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d: (typeof departments)[number]) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("manager")} id="managerId">
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger id="managerId">
                  <SelectValue placeholder={t("noManager")} />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m: (typeof managers)[number]) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("startDate")} required id="employmentStartDate">
              <Input id="employmentStartDate" name="employmentStartDate" type="date" required />
            </Field>
            <Field label={t("employmentType")} id="employmentType">
              <Select defaultValue="FULL_TIME" name="employmentType">
                <SelectTrigger id="employmentType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_TIME">{tEmployment("FULL_TIME")}</SelectItem>
                  <SelectItem value="PART_TIME">{tEmployment("PART_TIME")}</SelectItem>
                  <SelectItem value="CONTRACTOR">{tEmployment("CONTRACTOR")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("jobTitle")} id="title">
              <Input id="title" name="title" placeholder="Software Engineer" />
            </Field>
            <Field label={t("password")} required id="password" className="sm:col-span-2">
              <div className="flex gap-2">
                <Input
                  id="password"
                  name="password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  minLength={8}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    const next = generatePassword();
                    setPassword(next);
                    setConfirm(next);
                  }}
                >
                  <Dices className="size-4" />
                  {t("generate")}
                </Button>
              </div>
            </Field>
            <Field label={t("confirmPassword")} required id="confirm" className="sm:col-span-2">
              <Input
                id="confirm"
                name="confirm"
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("repeatPassword")}
                minLength={8}
                required
              />
            </Field>
          </div>
          {password.length > 0 && confirm.length > 0 && password !== confirm ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {t("passwordMismatch")}
            </p>
          ) : null}
          {translateError(state) ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {translateError(state)}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <SubmitButton disabled={password !== confirm || password.length < 8} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
