import { NextResponse } from "next/server";
import { prisma } from "@timeoff/db";
import { isValidISODate } from "@timeoff/domain";
import { getCurrentUser } from "@/lib/session";
import { listCalendarRequests, listCalendarRoster } from "@/lib/services/calendar";
import { companyHolidays } from "@/lib/services/leave";
import type { RequestStatus } from "@/lib/calendar-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scoped calendar feed for the explorer: bars/list/team data + holidays. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }

  const statuses = (url.searchParams.get("statuses") ?? "approved")
    .split(",")
    .filter(Boolean) as RequestStatus[];
  const departmentId = url.searchParams.get("department") ?? undefined;
  const leaveTypeId = url.searchParams.get("leaveType") ?? undefined;
  const roster = url.searchParams.get("roster") === "1";

  const [requests, rosterData, holidays] = await Promise.all([
    listCalendarRequests(user, {
      from,
      to,
      departmentId,
      leaveTypeId,
      statuses,
    }),
    roster ? listCalendarRoster(user) : Promise.resolve([]),
    companyHolidays(prisma, user.companyId!, from, to),
  ]);

  return NextResponse.json({
    requests,
    roster: rosterData,
    holidays: [...holidays],
  });
}
