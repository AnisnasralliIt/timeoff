"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@timeoff/ui";

export function WorkforceFilters({
  leaveYears,
  departments,
  selectedYearStart,
  selectedDepartmentId,
  showDepartmentFilter,
}: {
  leaveYears: { start: string; year: number }[];
  departments: { id: string; name: string }[];
  selectedYearStart: string;
  selectedDepartmentId?: string;
  showDepartmentFilter: boolean;
}) {
  const t = useTranslations("workforce");
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.push(query ? `/workforce?${query}` : "/workforce");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={selectedYearStart} onValueChange={(start) => update({ year: start })}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t("filterLeaveYear")}>
          <SelectValue placeholder={t("filterLeaveYear")} />
        </SelectTrigger>
        <SelectContent>
          {leaveYears.map((leaveYear) => (
            <SelectItem key={leaveYear.start} value={leaveYear.start}>
              {t("leaveYearOption", { year: leaveYear.year })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showDepartmentFilter ? (
        <Select
          value={selectedDepartmentId ?? "all"}
          onValueChange={(id) => update({ department: id === "all" ? undefined : id })}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t("filterDepartment")}>
            <SelectValue placeholder={t("filterDepartment")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allDepartments")}</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
