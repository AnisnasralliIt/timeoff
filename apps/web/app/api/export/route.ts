import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@timeoff/db";
import { isValidISODate, todayISO } from "@timeoff/domain";
import { getCurrentUser } from "@/lib/session";
import { getUserScope } from "@/lib/permissions";
import { LeaveError, audit } from "@/lib/services/leave";
import { listExportRows } from "@/lib/services/calendar";
import { buildLeaveExportWorkbook } from "@/lib/excel";
import { slugify, type RequestStatus } from "@/lib/calendar-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface ExportBody {
  scope?: "filtered" | "all";
  from?: string;
  to?: string;
  departmentId?: string;
  leaveTypeId?: string;
  statuses?: RequestStatus[];
}

/**
 * Scoped, audit-logged Excel export. Access model (mirrors the calendar):
 *  - HR/ADMIN/SUPER_ADMIN/EXECUTIVE: full company
 *  - MANAGER: own department only (ignores any department filter, enforced
 *    server-side by the shared scoping helper)
 *  - EMPLOYEE: denied (403)
 * Every successful export writes an AuditLog entry.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ errorCode: "notSignedIn" }, { status: 401 });
  }

  let body: ExportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errorCode: "invalidExportRequest" }, { status: 400 });
  }

  const scopeAll = body.scope === "all";
  const from = scopeAll ? undefined : body.from;
  const to = scopeAll ? undefined : body.to;
  if (!scopeAll && (!from || !to || !isValidISODate(from) || !isValidISODate(to) || from > to)) {
    return NextResponse.json({ errorCode: "invalidExportRange" }, { status: 400 });
  }

  const statuses: RequestStatus[] =
    body.statuses?.length && body.statuses.length > 0 ? body.statuses : ["APPROVED", "PENDING"];

  let rows;
  try {
    rows = await listExportRows(user, {
      from,
      to,
      departmentId: body.departmentId,
      leaveTypeId: body.leaveTypeId,
      statuses,
    });
  } catch (error) {
    if (error instanceof LeaveError) {
      return NextResponse.json({ errorCode: "exportForbidden" }, { status: 403 });
    }
    throw error;
  }

  const locale = await getLocale();
  const t = await getTranslations("export");
  const tStatus = await getTranslations("status");
  const tDayPart = await getTranslations("dayPart");

  const scope = getUserScope(user);
  const scopeDepartmentId = scope.kind === "department" ? scope.departmentId : body.departmentId;
  const department = scopeDepartmentId
    ? await prisma.department.findUnique({ where: { id: scopeDepartmentId } })
    : null;
  const company = await prisma.company.findUnique({ where: { id: user.companyId! } });

  const today = todayISO();
  const scopeName = department?.name ?? null;
  const filename = `timeoff-export-${today}${scopeName ? `-${slugify(scopeName)}` : ""}.xlsx`;

  const dateLabel = new Date(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  ).toLocaleDateString(locale, { dateStyle: "medium" });

  const buffer = await buildLeaveExportWorkbook({
    title: t("title"),
    scopeLine: [company?.name ?? "", dateLabel, t("rowCount", { count: rows.length })]
      .filter(Boolean)
      .join(" · "),
    rows,
    headers: {
      sheetName: t("sheetName"),
      employee: t("employee"),
      department: t("department"),
      leaveType: t("leaveType"),
      startDate: t("startDate"),
      endDate: t("endDate"),
      startHalf: t("startHalf"),
      endHalf: t("endHalf"),
      workingDays: t("workingDays"),
      status: t("status"),
      reason: t("reason"),
      approver: t("approver"),
      decisionDate: t("decisionDate"),
      rejectionReason: t("rejectionReason"),
      submitted: t("submitted"),
    },
    labels: {
      status: {
        APPROVED: tStatus("APPROVED"),
        PENDING: tStatus("PENDING"),
        REJECTED: tStatus("REJECTED"),
        CANCELLED: tStatus("CANCELLED"),
        DRAFT: tStatus("DRAFT"),
      },
      dayPart: {
        FULL: tDayPart("FULL"),
        FIRST_HALF: tDayPart("FIRST_HALF"),
        SECOND_HALF: tDayPart("SECOND_HALF"),
      },
    },
    filename,
  });

  await audit(prisma, {
    companyId: user.companyId!,
    actorId: user.id,
    action: "export.requests",
    entityType: "LeaveRequest",
    entityId: "export",
    after: {
      format: "xlsx",
      scope: scopeAll ? "all" : "filtered",
      from,
      to,
      departmentId: department?.id ?? null,
      statuses,
      rowCount: rows.length,
      filename,
    },
  });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
