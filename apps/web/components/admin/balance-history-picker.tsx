"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";

export function BalanceHistoryPicker({
  users,
  value,
}: {
  users: { id: string; name: string }[];
  value?: string;
}) {
  const t = useTranslations("adminBalances");
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <Select
      value={value ?? "none"}
      onValueChange={(id) => {
        const params = new URLSearchParams(searchParams.toString());
        if (id === "none") params.delete("user");
        else params.set("user", id);
        const query = params.toString();
        router.push(query ? `/admin/balances?${query}` : "/admin/balances");
      }}
    >
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue placeholder={t("selectEmployee")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("allEmployees")}</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
