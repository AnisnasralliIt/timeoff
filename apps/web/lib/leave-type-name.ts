export type LeaveTypeLike = {
  name: string;
  nameEn: string | null;
  nameFr: string | null;
};

export function resolveLeaveTypeName(lt: LeaveTypeLike, locale: string): string {
  if (locale === "fr" && lt.nameFr) return lt.nameFr;
  if (locale === "en" && lt.nameEn) return lt.nameEn;
  return lt.name;
}
