import { NextRequest, NextResponse } from "next/server";
import { isValidISODate } from "@timeoff/domain";
import { getCurrentUser } from "@/lib/session";
import { AuditAccessError, listAuditLog, type AuditLogQuery } from "@/lib/services/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function isIsoDateOrEmpty(value: string | undefined): boolean {
  if (!value) return true;
  return isValidISODate(value);
}

/**
 * GET /api/audit-log — scoped, paginated audit trail.
 * Access: HR/ADMIN/SUPER_ADMIN see the whole company; MANAGER only their own
 * team (enforced in SQL by the service); EMPLOYEE/EXECUTIVE get 403.
 * Append-only: no create/update/delete endpoints exist for audit entries.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ errorCode: "notSignedIn" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const query: AuditLogQuery = {
    search: str(params.get("search")),
    action: str(params.get("action")),
    entityType: str(params.get("entityType")),
    actorId: str(params.get("actorId")),
    employeeId: str(params.get("employeeId")),
    from: str(params.get("from")),
    to: str(params.get("to")),
  };

  if (query.from && query.to && query.from > query.to) {
    return NextResponse.json({ errorCode: "invalidRange" }, { status: 400 });
  }
  if (!isIsoDateOrEmpty(query.from) || !isIsoDateOrEmpty(query.to)) {
    return NextResponse.json({ errorCode: "invalidDate" }, { status: 400 });
  }

  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ errorCode: "invalidPagination" }, { status: 400 });
  }

  try {
    const result = await listAuditLog(user, { ...query, page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuditAccessError) {
      return NextResponse.json({ errorCode: "auditForbidden" }, { status: 403 });
    }
    throw error;
  }
}
