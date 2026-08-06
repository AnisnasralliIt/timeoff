import { requireRole403 } from "@/lib/session";

export default async function StyleGuideLayout({ children }: { children: React.ReactNode }) {
  await requireRole403(["SUPER_ADMIN"]);
  return <>{children}</>;
}
