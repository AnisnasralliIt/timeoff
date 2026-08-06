"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@timeoff/ui";
import { updateUserAction } from "@/lib/actions/admin";
import { useServerError } from "@/lib/client-error";

type Dept = { id: string; name: string };
type Manager = { id: string; name: string };

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  title: string | null;
  employmentStartDate: string;
  employmentType: string;
  department: string | null;
  manager: string | null;
  vacationAvailable: number | null;
};

function SubmitButton() {
  const t = useTranslations("adminDialogs.editUser");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("saving") : t("saveChanges")}
    </Button>
  );
}

export function EditUserDialog({
  user,
  departments,
  managers,
  canGrantAdmin,
}: {
  user: AdminUser;
  departments: Dept[];
  managers: Manager[];
  canGrantAdmin: boolean;
}) {
  const t = useTranslations("adminDialogs.createUser");
  const tEdit = useTranslations("adminDialogs.editUser");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("roles");
  const tStatus = useTranslations("userStatus");
  const tEmployment = useTranslations("employment");
  const translateError = useServerError();
  const [state, formAction] = useActionState(updateUserAction.bind(null, user.id), {});
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [departmentId, setDepartmentId] = useState(
    departments.find((d) => d.name === user.department)?.id ?? departments[0]?.id ?? "",
  );
  const [managerId, setManagerId] = useState(
    managers.find((m) => m.name === user.manager)?.id ?? "",
  );
  const [employmentType, setEmploymentType] = useState(user.employmentType);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" />
          {tEdit("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="departmentId" value={departmentId} />
          <input type="hidden" name="managerId" value={managerId} />
          <input type="hidden" name="employmentType" value={employmentType} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("role")} id="role">
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
                  {user.role === "SUPER_ADMIN" ? <SelectItem value="SUPER_ADMIN">{tRole("SUPER_ADMIN")}</SelectItem> : null}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("status")} id="status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">{tStatus("ACTIVE")}</SelectItem>
                  <SelectItem value="INACTIVE">{tStatus("INACTIVE")}</SelectItem>
                  <SelectItem value="OFFBOARDED">{tStatus("OFFBOARDED")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("department")} id="departmentId">
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="departmentId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
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
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("employmentType")} id="employmentType">
              <Select value={employmentType} onValueChange={setEmploymentType}>
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
              <Input id="title" name="title" defaultValue={user.title ?? ""} placeholder={t("jobTitle")} />
            </Field>
          </div>
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
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
