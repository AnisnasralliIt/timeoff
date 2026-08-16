/**
 * RBAC/department-scoping access smoke test (run via tsx against the seeded
 * dev DB). Verifies, at the service layer:
 *   - only HR/ADMIN/SUPER_ADMIN can run people ops
 *   - only SUPER_ADMIN can grant ADMIN / SUPER_ADMIN
 *   - EMPLOYEE and EXECUTIVE can never approve
 *   - MANAGER is scoped to their own department (view + decide + delegate)
 *   - company-wide roles see all pending requests
 * Cleanup is done inline; re-seeding also reproduces canonical state.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load DATABASE_URL from packages/db/.env when not already set, so this script
 * runs identically regardless of cwd (tsx resolves tsconfig by cwd, so it must
 * be launched from apps/web).
 */
function ensureEnv() {
  if (process.env.DATABASE_URL) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "../../packages/db/.env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (!match) continue;
      const key = match[1]!;
      if (!(key in process.env)) process.env[key] = match[2] ?? "";
    }
  } catch {
    // Leave env untouched; prisma will report a clear error if it is missing.
  }
}
ensureEnv();

import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "@timeoff/db";
import { accruedVacationAsOf, leaveYearRange, computeLeaveDays } from "@timeoff/domain";
import type { SessionUser } from "../lib/session";
import type { CalendarLeave, CalendarRosterMember, RequestStatus } from "../lib/calendar-shared";
import {
  getVisibleUserIds,
  getUserScope,
  resolveDepartmentId,
  canGrantRole,
  isSupervisorRole,
} from "../lib/permissions";
import {
  listPendingForApproval,
  canUserDecide,
  decideLeaveRequest,
  createDelegation,
  deactivateDelegation,
  listDelegationCandidates,
  syncCurrentAccruals,
  resolveBalanceForDate,
  balanceHistoryFor,
  audit,
  LeaveError,
  companyHolidays,
} from "../lib/services/leave";
import { listAuditLog, canViewAuditLog, AuditAccessError } from "../lib/services/audit";
import {
  createUserForAdmin,
  updateUserForAdmin,
  deleteUserForAdmin,
  listUsersForAdmin,
  createLeaveTypeForAdmin,
  deleteLeaveTypeForAdmin,
  archiveLeaveTypeForAdmin,
  reactivateLeaveTypeForAdmin,
  updateCompanySettingsForAdmin,
} from "../lib/services/admin";
import { canViewRequest } from "../lib/services/attachments";
import {
  listHolidaysForAdmin,
  createHolidayForAdmin,
  updateHolidayForAdmin,
  deleteHolidayForAdmin,
  importNagerHolidaysForAdmin,
} from "../lib/services/holidays";
import {
  listCalendarRequests,
  listCalendarRoster,
  listExportRows,
  canExport,
  type ExportRow,
} from "../lib/services/calendar";
import { buildLeaveExportWorkbook } from "../lib/excel";

const EMAILS = {
  superAdmin: "anna.klein@acme.dev",
  admin: "sofia.braun@acme.dev",
  hr: "julia.hoffmann@acme.dev",
  executive: "robert.schmidt@acme.dev",
  engineeringManager: "lukas.fischer@acme.dev",
  engineeringDelegate: "felix.wagner@acme.dev",
  productManager: "emma.klein@acme.dev",
};

let failures = 0;
let checks = 0;

async function check(label: string, fn: () => void | Promise<void>) {
  checks++;
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function userByEmail(email: string): Promise<SessionUser> {
  const row = await prisma.user.findFirst({ where: { email } });
  assert(row, `seed user ${email} not found`);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    companyId: row.companyId,
    departmentId: row.departmentId,
  };
}

async function pendingRequestIn(departmentName: string) {
  const row = await prisma.leaveRequest.findFirst({
    where: { status: "PENDING", user: { department: { name: departmentName } } },
    include: { user: { select: { id: true, name: true, managerId: true, departmentId: true } } },
    orderBy: { createdAt: "asc" },
  });
  assert(row, `no pending request found in ${departmentName}`);
  return row;
}

async function main() {
  const superAdmin = await userByEmail(EMAILS.superAdmin);
  const admin = await userByEmail(EMAILS.admin);
  const hr = await userByEmail(EMAILS.hr);
  const executive = await userByEmail(EMAILS.executive);
  const lukas = await userByEmail(EMAILS.engineeringManager);
  const felix = await userByEmail(EMAILS.engineeringDelegate);
  const emma = await userByEmail(EMAILS.productManager);

  // A regular employee (first ACTIVE user that is not an approver), with at
  // least one approved request so later scope/attachment checks have data.
  const employeeRow = await prisma.user.findFirst({
    where: {
      status: "ACTIVE",
      role: "EMPLOYEE",
      department: { name: "Product" },
      requests: { some: { status: "APPROVED" } },
    },
    orderBy: { name: "asc" },
  });
  assert(employeeRow, "no seed employee found");
  const employee: SessionUser = {
    id: employeeRow.id,
    email: employeeRow.email,
    name: employeeRow.name,
    role: "EMPLOYEE",
    companyId: employeeRow.companyId,
    departmentId: employeeRow.departmentId,
  };

  const productPending = await pendingRequestIn("Product");
  const engineeringPending = await pendingRequestIn("Engineering");
  const otherDeptEmployeeRequest = await prisma.leaveRequest.findFirst({
    where: {
      status: "APPROVED",
      userId: employeeRow.id,
      user: { departmentId: employeeRow.departmentId },
    },
  });
  assert(otherDeptEmployeeRequest, "no employee request found");

  console.log("\n— Department scope helpers —");
  await check("lukas (MANAGER) scope is department, not all", async () => {
    assert.equal(getUserScope(lukas).kind, "department");
    const visible = await getVisibleUserIds(lukas);
    assert.notEqual(visible, "all");
    assert(Array.isArray(visible), "expected an id list");
    assert(!visible.includes(emma.id), "lukas must not see Product users");
    assert(visible.includes(felix.id), "lukas must see Engineering users");
  });
  await check("admin/HR/EXECUTIVE scope is company-wide", async () => {
    for (const u of [admin, hr, executive, superAdmin]) {
      assert.equal((await getVisibleUserIds(u)), "all", `${u.role} should be company-wide`);
    }
  });

  console.log("\n— Approval queues —");
  await check("EMPLOYEE has no approval queue", async () => {
    assert.equal((await listPendingForApproval(employee)).length, 0);
  });
  await check("EXECUTIVE has no approval queue (read-only)", async () => {
    assert.equal((await listPendingForApproval(executive)).length, 0);
  });
  await check("HR/ADMIN/SUPER_ADMIN see cross-department pending requests", async () => {
    const queues = [await listPendingForApproval(hr), await listPendingForApproval(admin), await listPendingForApproval(superAdmin)];
    for (const q of queues) {
      assert(q.some((r: (typeof q)[number]) => r.user.departmentId === productPending.user.departmentId), "queue must include Product requests");
    }
  });
  await check("MANAGER queue is scoped to own department", async () => {
    const queue = await listPendingForApproval(lukas);
    const dept = await resolveDepartmentId(lukas);
    assert(queue.length > 0, "lukas should have pending requests");
    for (const r of queue) assert.equal(r.user.departmentId, dept, "cross-department request leaked");
  });

  console.log("\n— canUserDecide / decideLeaveRequest —");
  await check("HR can decide Product request", async () => {
    assert.equal(await canUserDecide(hr, productPending.id), true);
  });
  await check("ADMIN can decide Product request", async () => {
    assert.equal(await canUserDecide(admin, productPending.id), true);
  });
  await check("SUPER_ADMIN can decide Product request", async () => {
    assert.equal(await canUserDecide(superAdmin, productPending.id), true);
  });
  await check("Dept-A MANAGER cannot decide Dept-B request", async () => {
    assert.equal(await canUserDecide(lukas, productPending.id), false);
  });
  await check("EMPLOYEE cannot decide any request", async () => {
    assert.equal(await canUserDecide(employee, productPending.id), false);
  });
  await check("EXECUTIVE cannot decide any request (read-only)", async () => {
    assert.equal(await canUserDecide(executive, productPending.id), false);
  });
  await check("MANAGER can decide own-department request", async () => {
    const mine = await listPendingForApproval(lukas);
    assert(mine.length > 0);
    const mineFirst = mine[0];
    assert(mineFirst, "queue empty");
    assert.equal(await canUserDecide(lukas, mineFirst.id), true);
  });
  await check("EMPLOYEE approve call is rejected (no mutation)", async () => {
    await assert.rejects(
      () => decideLeaveRequest(employee, productPending.id, { outcome: "APPROVED" }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("EXECUTIVE approve call is rejected (no mutation)", async () => {
    await assert.rejects(
      () => decideLeaveRequest(executive, productPending.id, { outcome: "APPROVED" }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("Dept-A MANAGER approving Dept-B request is rejected (no mutation)", async () => {
    await assert.rejects(
      () => decideLeaveRequest(lukas, productPending.id, { outcome: "APPROVED" }),
      (e) => e instanceof LeaveError,
    );
  });

  console.log("\n— Request / attachment visibility —");
  await check("EMPLOYEE can view own request", async () => {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: otherDeptEmployeeRequest.id },
      include: { user: { select: { id: true, managerId: true, departmentId: true } } },
    });
    assert(request);
    assert.equal(await canViewRequest(request, employee), true);
  });
  await check("EMPLOYEE cannot view someone else's request", async () => {
    assert.equal(await canViewRequest(productPending, employee), false);
  });
  await check("Dept-A MANAGER cannot view Dept-B request", async () => {
    assert.equal(await canViewRequest(productPending, lukas), false);
  });
  await check("Dept-A MANAGER can view own-department request", async () => {
    assert.equal(await canViewRequest(engineeringPending, lukas), true);
  });

  console.log("\n— Delegation —");
  await check("MANAGER delegation candidates are same-department only", async () => {
    const candidates = await listDelegationCandidates(lukas);
    assert(candidates.length > 0);
    const dept = await resolveDepartmentId(lukas);
    for (const c of candidates) {
      const row = await prisma.user.findUnique({ where: { id: c.id }, select: { departmentId: true } });
      assert.equal(row?.departmentId, dept, "cross-department delegation candidate leaked");
    }
  });
  await check("MANAGER cannot delegate cross-department", async () => {
    await assert.rejects(
      () => createDelegation(lukas, { delegateId: emma.id }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("MANAGER can delegate within own department", async () => {
    const created = await createDelegation(lukas, { delegateId: felix.id, startsOn: "2026-08-01", endsOn: "2026-08-15" });
    await deactivateDelegation(lukas, created.id);
  });
  await check("EXECUTIVE cannot delegate", async () => {
    await assert.rejects(
      () => createDelegation(executive, { delegateId: felix.id }),
      (e) => e instanceof LeaveError,
    );
  });

  console.log("\n— Role assignment —");
  await check("canGrantRole: HR cannot grant ADMIN", () => {
    assert.equal(canGrantRole(hr, "ADMIN"), false);
  });
  await check("canGrantRole: SUPER_ADMIN can grant ADMIN", () => {
    assert.equal(canGrantRole(superAdmin, "ADMIN"), true);
  });
  await check("canGrantRole: SUPER_ADMIN is never assignable via API", () => {
    assert.equal(canGrantRole(superAdmin, "SUPER_ADMIN"), false);
  });
  await check("HR creating an ADMIN user is rejected", async () => {
    await assert.rejects(
      () =>
        createUserForAdmin(hr, {
          name: "Rogue Admin",
          email: "rogue.admin@acme.dev",
          role: "ADMIN",
          password: "password123",
          departmentId: hr.departmentId!,
          employmentStartDate: "2026-01-01",
        }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("HR promoting an employee to ADMIN is rejected", async () => {
    await assert.rejects(
      () => updateUserForAdmin(hr, employeeRow.id, { role: "ADMIN" }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("HR demoting an ADMIN is rejected", async () => {
    await assert.rejects(
      () => updateUserForAdmin(hr, admin.id, { role: "EMPLOYEE" }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("SUPER_ADMIN creating an ADMIN user works and password verifies", async () => {
    const created = await createUserForAdmin(superAdmin, {
      name: "Temp Admin",
      email: "temp.admin@acme.dev",
      role: "ADMIN",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-01-01",
    });
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    assert(row, "created user missing");
    assert(row.passwordHash, "created user has no password hash");
    assert.equal(row.role, "ADMIN");
    assert(await bcrypt.compare("s3cure-pass-99", row.passwordHash), "password hash mismatch");
    await prisma.user.delete({ where: { id: created.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: created.id } });
  });
  await check("new user gets an auto-seeded balance at creation (L8)", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");

    // Effective (company-wide) policies with a positive allotment are the ones a
    // brand-new user is seeded for. Data-driven so edits to policies don't break
    // the check.
    const policies = await prisma.leavePolicy.findMany({
      where: {
        companyId: company.id,
        annualAllotment: { gt: 0 },
        departmentId: null,
      },
      include: { leaveType: { select: { name: true } } },
    });
    assert(policies.length > 0, "no positive-allotment company-wide policies");
    const vacationPolicy = policies.find((p) => p.leaveType.name === "Vacation");
    assert(vacationPolicy, "no company-wide Vacation policy with a positive allotment");

    const today = new Date().toISOString().slice(0, 10);
    const startYear =
      company.fiscalYearStartMonth > 1 && Number(today.slice(5, 7)) < company.fiscalYearStartMonth
        ? Number(today.slice(0, 4)) - 1
        : Number(today.slice(0, 4));
    const { start, end } = leaveYearRange(company.fiscalYearStartMonth, startYear);
    // Cumulative accrual as of today: July 2026 hire → July + August = 2 months.
    const expectedAccrued = accruedVacationAsOf({
      annualAllotment: vacationPolicy.annualAllotment,
      employmentStartDate: "2026-07-01",
      asOf: today,
    });

    const before = await prisma.leaveBalance.count({ where: { companyId: company.id } });
    const created = await createUserForAdmin(superAdmin, {
      name: "Auto Balance",
      email: "auto.balance@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-07-01",
    });

    const balances = await prisma.leaveBalance.findMany({
      where: { userId: created.id },
      include: { leaveType: true },
    });
    assert.equal(balances.length, policies.length, `expected ${policies.length} seeded balance rows, got ${balances.length}`);
    const row = balances.find((b) => b.leaveType.name === "Vacation");
    assert(row, "Vacation balance row missing for new user");
    assert.equal(row.periodStart, start);
    assert.equal(row.periodEnd, end);
    assert.equal(row.accrued, expectedAccrued, `expected ${expectedAccrued} prorated days`);
    assert.equal(row.carriedOver, 0);
    assert.equal(row.adjustment, 0);
    assert.equal(row.used + row.pending, 0);
    assert.equal(row.accrued + row.carriedOver + row.adjustment - row.used - row.pending, expectedAccrued);

    // Visible through the admin list with zero manual steps.
    const listed = (await listUsersForAdmin(hr)).find((r) => r.id === created.id);
    assert.equal(listed?.vacationAvailable, expectedAccrued);

    // Non-retroactive: only the new user's rows were added.
    const after = await prisma.leaveBalance.count({ where: { companyId: company.id } });
    assert.equal(after - before, policies.length, "creation touched more balances than the new user's own");

    await prisma.user.delete({ where: { id: created.id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: created.id } });
  });
  await check("password policy: short password is rejected", async () => {
    await assert.rejects(
      () =>
        createUserForAdmin(superAdmin, {
          name: "Short Pass",
          email: "short.pass@acme.dev",
          role: "EMPLOYEE",
          password: "short",
          departmentId: superAdmin.departmentId!,
          employmentStartDate: "2026-01-01",
        }),
      (e) => e instanceof LeaveError,
    );
  });
  await check("SUPER_ADMIN can promote an employee to ADMIN and revert", async () => {
    await updateUserForAdmin(superAdmin, employeeRow.id, { role: "ADMIN" });
    const promoted = await prisma.user.findUnique({ where: { id: employeeRow.id } });
    assert.equal(promoted?.role, "ADMIN");
    await updateUserForAdmin(superAdmin, employeeRow.id, { role: "EMPLOYEE" });
    const reverted = await prisma.user.findUnique({ where: { id: employeeRow.id } });
    assert.equal(reverted?.role, "EMPLOYEE");
  });

  console.log("\n— Calendar + Excel export scoping (stage 2) —");
  const YEAR: { from: string; to: string; statuses: RequestStatus[] } = {
    from: "2026-01-01",
    to: "2026-12-31",
    statuses: ["APPROVED", "PENDING"],
  };

  await check("lukas calendar sees only Engineering requests", async () => {
    const rows = await listCalendarRequests(lukas, YEAR);
    assert(rows.length > 0, "expected Engineering requests in 2026");
    const productIds = new Set((await listCalendarRoster(emma)).map((u: CalendarRosterMember) => u.id));
    for (const r of rows) {
      assert(!productIds.has(r.userId), `Product request leaked to Engineering manager: ${r.userName}`);
    }
  });

  await check("admin calendar sees cross-department requests", async () => {
    const rows = await listCalendarRequests(admin, YEAR);
    const depts = new Set(rows.map((r: CalendarLeave) => r.departmentId));
    assert(rows.length > 0);
    const productDept = (await prisma.user.findUnique({ where: { id: emma.id } }))?.departmentId;
    const engDept = (await prisma.user.findUnique({ where: { id: felix.id } }))?.departmentId;
    assert(depts.has(productDept!), "admin calendar missing Product requests");
    assert(depts.has(engDept!), "admin calendar missing Engineering requests");
  });

  await check("roster is scoped (manager vs company-wide)", async () => {
    const lukasRoster = await listCalendarRoster(lukas);
    assert(lukasRoster.length > 0);
    const dept = await resolveDepartmentId(lukas);
    for (const m of lukasRoster) assert.equal(m.departmentId, dept, "cross-department roster member leaked");
    const adminRoster = await listCalendarRoster(admin);
    const emmaRow = await prisma.user.findUnique({ where: { id: emma.id } });
    assert(adminRoster.some((m: CalendarRosterMember) => m.id === emmaRow?.id), "admin roster missing Product user");
    assert(!lukasRoster.some((m: CalendarRosterMember) => m.id === emmaRow?.id), "manager roster leaked Product user");
  });

  await check("canExport: EMPLOYEE denied, MANAGER + company-wide allowed", () => {
    assert.equal(canExport(employee), false);
    assert.equal(canExport(lukas), true);
    assert.equal(canExport(admin), true);
    assert.equal(canExport(hr), true);
    assert.equal(canExport(executive), true);
    assert.equal(canExport(superAdmin), true);
  });

  await check("listExportRows: EMPLOYEE is rejected", async () => {
    await assert.rejects(
      () => listExportRows(employee, { from: "2026-01-01", to: "2026-12-31", statuses: ["APPROVED"] }),
      (e) => e instanceof LeaveError,
    );
  });

  await check("listExportRows: manager export is department-only", async () => {
    const productDept = (await prisma.user.findUnique({ where: { id: emma.id } }))?.departmentId;
    const rows = await listExportRows(lukas, {
      from: "2026-01-01",
      to: "2026-12-31",
      // Even an explicit foreign-department filter must be ignored server-side.
      departmentId: productDept,
      statuses: ["APPROVED", "PENDING", "REJECTED"],
    });
    assert(rows.length > 0, "expected Engineering export rows");
    const lukasDept = await resolveDepartmentId(lukas);
    for (const r of rows) {
      const owner = await prisma.leaveRequest.findUnique({
        where: { id: r.id },
        select: { user: { select: { departmentId: true } } },
      });
      assert.equal(owner?.user.departmentId, lukasDept, "cross-department export row leaked");
    }
  });

  await check("listExportRows: manager 'export everything' is still department-only", async () => {
    const rows = await listExportRows(lukas, { statuses: ["APPROVED", "PENDING", "REJECTED"] });
    const dept = await resolveDepartmentId(lukas);
    for (const r of rows) {
      const owner = await prisma.leaveRequest.findUnique({
        where: { id: r.id },
        select: { user: { select: { departmentId: true } } },
      });
      assert.equal(owner?.user.departmentId, dept, "cross-department row in manager all-export");
    }
  });

  await check("listExportRows: company-wide roles export both departments", async () => {
    const rows = await listExportRows(admin, {
      from: "2026-01-01",
      to: "2026-12-31",
      statuses: ["APPROVED", "PENDING"],
    });
    const depts = new Set(rows.map((r: ExportRow) => r.department));
    assert(rows.length > 0);
    assert(depts.has("Engineering"), "admin export missing Engineering");
    assert(depts.has("Product"), "admin export missing Product");
  });

  await check("buildLeaveExportWorkbook produces a real xlsx (zip magic + frozen header)", async () => {
    const row = (await listExportRows(admin, {
      from: "2026-01-01",
      to: "2026-12-31",
      statuses: ["APPROVED"],
    }))[0];
    assert(row, "no export row available");
    const headers = {
      sheetName: "Leave requests",
      employee: "Employee", department: "Department", leaveType: "Leave type",
      startDate: "Start date", endDate: "End date", startHalf: "Start day", endHalf: "End day",
      workingDays: "Working days", status: "Status", reason: "Reason", approver: "Approver",
      decisionDate: "Approval / rejection date", rejectionReason: "Rejection reason", submitted: "Submitted",
    };
    const labels = {
      status: { DRAFT: "Draft", PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" },
      dayPart: { FULL: "Full day", FIRST_HALF: "First half (morning)", SECOND_HALF: "Second half (afternoon)" },
    };
    const buffer = await buildLeaveExportWorkbook({
      title: "Leave export",
      scopeLine: "Acme · 2026-08-06",
      rows: [row],
      headers,
      labels,
      filename: "timeoff-export-2026-08-06.xlsx",
    });
    assert(buffer.length > 4000, "xlsx buffer suspiciously small");
    assert.equal(buffer[0], 0x50, "expected zip magic PK");
    assert.equal(buffer[1], 0x4b, "expected zip magic PK");
  });

  /* ---- Bug 1: only managers / higher roles are selectable as responsable ---- */
  await check("B1: an EMPLOYEE is not a supervisor role", () => {
    assert.equal(isSupervisorRole("EMPLOYEE"), false);
    assert.equal(isSupervisorRole("MANAGER"), true);
    assert.equal(isSupervisorRole("HR"), true);
    assert.equal(isSupervisorRole("EXECUTIVE"), true);
  });
  await check("B1: creating a user whose manager is a plain EMPLOYEE is rejected", async () => {
    await assert.rejects(
      () =>
        createUserForAdmin(superAdmin, {
          name: "Bad Manager",
          email: "bad.manager@acme.dev",
          role: "EMPLOYEE",
          password: "s3cure-pass-99",
          departmentId: superAdmin.departmentId!,
          managerId: employeeRow.id,
          employmentStartDate: "2026-01-01",
        }),
      (e) => e instanceof LeaveError && /responsable/i.test(e.message),
    );
  });
  await check("B1: updating a user to report to a plain EMPLOYEE is rejected", async () => {
    const temp = await createUserForAdmin(superAdmin, {
      name: "Mgr Check",
      email: "mgr.check@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-01-01",
    });
    try {
      await assert.rejects(
        () => updateUserForAdmin(superAdmin, temp.id, { managerId: employeeRow.id }),
        (e) => e instanceof LeaveError && /responsable/i.test(e.message),
      );
    } finally {
      await prisma.user.delete({ where: { id: temp.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: temp.id } });
    }
  });
  await check("B1: assigning a MANAGER as responsable succeeds", async () => {
    const temp = await createUserForAdmin(superAdmin, {
      name: "Good Mgr",
      email: "good.mgr@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      managerId: lukas.id,
      employmentStartDate: "2026-01-01",
    });
    try {
      const row = await prisma.user.findUnique({ where: { id: temp.id } });
      assert.equal(row?.managerId, lukas.id);
    } finally {
      await prisma.user.delete({ where: { id: temp.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: temp.id } });
    }
  });

  /* ---- Bug 2: permanent leave-type deletion ---- */
  await check("B2: permanently deleting an unused leave type works", async () => {
    const created = await createLeaveTypeForAdmin(superAdmin, {
      name: "Temp Delete Me",
      color: "#123456",
      requiresApproval: true,
      requiresAttachment: false,
      isPaid: true,
      annualAllotment: 10,
      carryOverDays: 0,
      negativeAllowed: false,
      probationDays: 0,
    });
    await deleteLeaveTypeForAdmin(superAdmin, created.id);
    const gone = await prisma.leaveType.findUnique({ where: { id: created.id } });
    assert.equal(gone, null, "leave type still exists after permanent delete");
    await prisma.auditLog.deleteMany({ where: { entityType: "LeaveType", entityId: created.id } });
  });
  await check("B2: deleting a used leave type is blocked with an error", async () => {
    const created = await createLeaveTypeForAdmin(superAdmin, {
      name: "Temp Used Type",
      color: "#654321",
      requiresApproval: true,
      requiresAttachment: false,
      isPaid: true,
      annualAllotment: 10,
      carryOverDays: 0,
      negativeAllowed: false,
      probationDays: 0,
    });
    try {
      const company = await prisma.company.findFirst();
      assert(company, "seed company not found");
      await prisma.leaveBalance.create({
        data: {
          companyId: company.id,
          userId: employeeRow.id,
          leaveTypeId: created.id,
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          accrued: 10,
          carriedOver: 0,
          adjustment: 0,
          used: 0,
          pending: 0,
        },
      });
      await assert.rejects(
        () => deleteLeaveTypeForAdmin(superAdmin, created.id),
        (e) => e instanceof LeaveError && /archive/i.test(e.message),
      );
      await prisma.leaveBalance.deleteMany({ where: { leaveTypeId: created.id } });
    } finally {
      await prisma.leaveBalance.deleteMany({ where: { leaveTypeId: created.id } });
      await prisma.leaveType.delete({ where: { id: created.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "LeaveType", entityId: created.id } });
    }
  });
  await check("B2: archived leave types can be reactivated", async () => {
    const created = await createLeaveTypeForAdmin(superAdmin, {
      name: "Temp Archive Me",
      color: "#abcdef",
      requiresApproval: true,
      requiresAttachment: false,
      isPaid: true,
      annualAllotment: 10,
      carryOverDays: 0,
      negativeAllowed: false,
      probationDays: 0,
    });
    try {
      await archiveLeaveTypeForAdmin(superAdmin, created.id);
      let row = await prisma.leaveType.findUnique({ where: { id: created.id } });
      assert.equal(row?.isArchived, true);
      await reactivateLeaveTypeForAdmin(superAdmin, created.id);
      row = await prisma.leaveType.findUnique({ where: { id: created.id } });
      assert.equal(row?.isArchived, false);
    } finally {
      await prisma.leaveType.delete({ where: { id: created.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "LeaveType", entityId: created.id } });
    }
  });

  /* ---- Bug 3: weekend settings persist in both directions ---- */
  await check("B3: weekend settings save and persist in both directions", async () => {
    const companyId = superAdmin.companyId!;
    const original = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        countWeekendsWithinSpan: true,
        extendWeekendAfterFriday: true,
        countHolidaysAsVacationDays: true,
      },
    });
    try {
      await updateCompanySettingsForAdmin(superAdmin, {
        countWeekendsWithinSpan: true,
        extendWeekendAfterFriday: false,
        countHolidaysAsVacationDays: true,
        halfDayEnabled: true,
        halfDayStartDay: true,
        halfDayEndDay: false,
      });
      let row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      assert.equal(row.countWeekendsWithinSpan, true);
      assert.equal(row.extendWeekendAfterFriday, false);
      assert.equal(row.countHolidaysAsVacationDays, true);
      assert.equal(row.halfDayEnabled, true);
      assert.equal(row.halfDayStartDay, true);
      assert.equal(row.halfDayEndDay, false);

      await updateCompanySettingsForAdmin(superAdmin, {
        countWeekendsWithinSpan: false,
        extendWeekendAfterFriday: true,
        countHolidaysAsVacationDays: false,
        halfDayEnabled: false,
        halfDayStartDay: true,
        halfDayEndDay: true,
      });
      row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      assert.equal(row.countWeekendsWithinSpan, false);
      assert.equal(row.extendWeekendAfterFriday, true);
      assert.equal(row.countHolidaysAsVacationDays, false);
      assert.equal(row.halfDayEnabled, false);
      assert.equal(row.halfDayStartDay, true);
      assert.equal(row.halfDayEndDay, true);
    } finally {
      await prisma.company.update({
        where: { id: companyId },
        data: {
          countWeekendsWithinSpan: original.countWeekendsWithinSpan,
          extendWeekendAfterFriday: original.extendWeekendAfterFriday,
          countHolidaysAsVacationDays: original.countHolidaysAsVacationDays,
          halfDayEnabled: false,
          halfDayStartDay: false,
          halfDayEndDay: false,
        },
      });
    }
  });

  /* ---- Bug 4: cumulative accrual (annual ÷ 12 × months from employment start to today) ---- */
  await check("B4: new-user balance is cumulative from the hire month (no fixed default, no annual reset)", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");
    // Effective company-wide Vacation policy (department-specific wins, none exist in seed).
    const policy = await prisma.leavePolicy.findFirst({
      where: { companyId: company.id, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
    });
    assert(policy, "no company-wide Vacation policy");
    const allotment = policy.annualAllotment;
    const today = new Date().toISOString().slice(0, 10);

    // Months worked from the hire month through today's month (both inclusive).
    const monthsToToday = (start: string) =>
      (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
      (Number(today.slice(5, 7)) - Number(start.slice(5, 7))) +
      1;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    // February 2026 hire → cumulative through today's month, never the fixed 15 or full allotment.
    const feb = await createUserForAdmin(superAdmin, {
      name: "Accrual Feb",
      email: "accrual.feb@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-02-01",
    });
    try {
      const febRow = await prisma.leaveBalance.findFirst({ where: { userId: feb.id, leaveTypeId: vacation.id } });
      assert(febRow, "feb hire has no balance row");
      const expectedFeb = round2((allotment / 12) * monthsToToday("2026-02-01"));
      assert.equal(febRow.accrued, expectedFeb, `feb hire accrued ${febRow.accrued}, expected ${expectedFeb}`);
      assert.notEqual(febRow.accrued, 15, "feb hire must not receive the fixed 15-day amount");
      assert.notEqual(febRow.accrued, allotment, "feb hire must not receive the full yearly allotment");

      // December 2025 hire → the 2026 row holds ONLY the 2026 slice (Dec 2025's
      // 1.5 days belong to the historical 2025 year), NOT the full yearly
      // allotment and NOT cumulative-through-today.
      const dec = await createUserForAdmin(superAdmin, {
        name: "Accrual Dec",
        email: "accrual.dec@acme.dev",
        role: "EMPLOYEE",
        password: "s3cure-pass-99",
        departmentId: superAdmin.departmentId!,
        employmentStartDate: "2025-12-01",
      });
      try {
        const decRow = await prisma.leaveBalance.findFirst({ where: { userId: dec.id, leaveTypeId: vacation.id } });
        assert(decRow, "dec hire has no balance row");
        const decSlice2025 = round2((allotment / 12) * 1);
        const expectedDec = round2((allotment / 12) * monthsToToday("2025-12-01")) - decSlice2025;
        assert.equal(decRow.accrued, expectedDec, `dec hire 2026 accrued ${decRow.accrued}, expected ${expectedDec} (per-year slice)`);
        assert.notEqual(decRow.accrued, allotment, "dec 2025 hire must not receive the full yearly allotment (no per-year grant)");
        assert.notEqual(decRow.accrued, decSlice2025, "dec 2025 hire must not be stuck at the December-only accrual (must grow through 2026)");
      } finally {
        await prisma.user.delete({ where: { id: dec.id } }).catch(() => {});
        await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: dec.id } });
      }
    } finally {
      await prisma.user.delete({ where: { id: feb.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: feb.id } });
    }
  });

  /* ---- Bug 2 fix: carry-over policy actually takes effect (L4) ---- */
  await check("carry-over: leftover is rolled over capped by policy, reconciled for existing rows", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");
    const policy = await prisma.leavePolicy.findFirst({
      where: { companyId: company.id, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
    });
    assert(policy, "no company-wide Vacation policy");
    const cap = policy.carryOverDays;
    const allotment = policy.annualAllotment;
    assert(cap > 0, "seed Vacation policy must have a positive carry-over cap for this check");
    assert(allotment >= 18, "seed Vacation allotment must be >= 18 for this check");

    const today = new Date().toISOString().slice(0, 10);
    const temp = await createUserForAdmin(superAdmin, {
      name: "Carry Over",
      email: "carry.over@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2025-01-01", // full 2025 year worked → full-year prior accrual
    });
    try {
      // Prior leave year with 18 days left unused (corrected accrual = full
      // allotment for a 2025-01-01 hire at year end).
      await prisma.leaveBalance.create({
        data: {
          companyId: company.id,
          userId: temp.id,
          leaveTypeId: vacation.id,
          periodStart: "2025-01-01",
          periodEnd: "2025-12-31",
          accrued: allotment,
          carriedOver: 0,
          adjustment: 0,
          used: allotment - 18,
          pending: 0,
        },
      });

      // Reconcile via the shared engine (what dashboard/admin/reporting run).
      await syncCurrentAccruals(prisma, company.id);
      let current = await prisma.leaveBalance.findFirst({
        where: { userId: temp.id, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });
      assert(current, "current-year row missing");
      const expected = Math.min(cap, 18);
      assert.equal(current.carriedOver, expected, `leftover 18 must carry ${expected} (cap ${cap})`);
      if (cap < 18) assert(current.carriedOver < 18, "cap must forfeit the excess days");

      // Idempotent: a second reconcile leaves the value alone.
      await syncCurrentAccruals(prisma, company.id);
      current = await prisma.leaveBalance.findFirst({
        where: { userId: temp.id, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });
      assert.equal(current!.carriedOver, expected, "second reconcile must not change carry-over");

      // Under the cap: 8 unused days carry fully. Usage is derived from the
      // APPROVED/PENDING vacation requests (the app's source of truth), so the
      // 2025 row's `used` and the request must agree: 18 - 10 used = 8 unused.
      await prisma.leaveBalance.update({ where: { id: current!.id }, data: { carriedOver: 0 } });
      await prisma.leaveBalance.updateMany({
        where: { userId: temp.id, leaveTypeId: vacation.id, periodStart: "2025-01-01" },
        data: { used: allotment - 8 },
      });
      await prisma.leaveRequest.create({
        data: {
          companyId: company.id,
          userId: temp.id,
          leaveTypeId: vacation.id,
          startDate: "2025-07-01",
          endDate: "2025-07-31",
          totalDays: allotment - 8,
          status: "APPROVED",
        },
      });
      await syncCurrentAccruals(prisma, company.id);
      current = await prisma.leaveBalance.findFirst({
        where: { userId: temp.id, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });
      assert.equal(current!.carriedOver, Math.min(cap, 8), "leftover 8 must carry fully when under the cap");

      // Request validation (resolveBalanceForDate) agrees with the reconciled
      // row the display paths read — one engine, no divergence.
      const resolution = await resolveBalanceForDate(
        prisma,
        { id: company.id, fiscalYearStartMonth: company.fiscalYearStartMonth },
        { id: temp.id, companyId: temp.companyId, employmentStartDate: "2025-01-01", employmentType: "FULL_TIME" },
        vacation.id,
        { annualAllotment: allotment, carryOverDays: cap },
        today,
      );
      assert(resolution && resolution.existing, "expected an existing-row balance resolution");
      const stored = await prisma.leaveBalance.findUniqueOrThrow({ where: { id: current!.id } });
      const storedAvailable =
        stored.accrued + stored.carriedOver + stored.adjustment - stored.used - stored.pending;
      assert.equal(
        resolution.available,
        storedAvailable,
        "validation available must equal the reconciled display value",
      );
    } finally {
      await prisma.leaveRequest.deleteMany({ where: { userId: temp.id } });
      await prisma.user.delete({ where: { id: temp.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: temp.id } });
      await prisma.leaveBalance.deleteMany({ where: { userId: temp.id } });
    }
  });

  /* ---- Bug 2 fix (round 2): carry-over derives from ACTUAL previous-year
   * data even when no prior-year balance row exists (usage lives in requests).
   * TEST 1..8 from the spec. ---- */
  await check("carry-over: computed from real previous-year usage when no prior row exists", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");
    const policy = await prisma.leavePolicy.findFirst({
      where: { companyId: company.id, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
    });
    assert(policy, "no company-wide Vacation policy");
    const cap = policy.carryOverDays;
    const allotment = policy.annualAllotment;
    assert(cap >= 15, `seed carry-over cap must be >= 15 for this check (got ${cap})`);
    assert(allotment >= 18, `seed allotment must be >= 18 for this check (got ${allotment})`);

    const makeUser = (email: string, start: string) =>
      createUserForAdmin(superAdmin, {
        name: "Carry Spec",
        email,
        role: "EMPLOYEE",
        password: "s3cure-pass-99",
        departmentId: superAdmin.departmentId!,
        employmentStartDate: start,
      });
    const add2025Request = (userId: string, totalDays: number) =>
      prisma.leaveRequest.create({
        data: {
          companyId: company.id,
          userId,
          leaveTypeId: vacation.id,
          startDate: "2025-07-01",
          endDate: "2025-07-31",
          totalDays,
          status: "APPROVED",
        },
      });
    const currentRow = (userId: string) =>
      prisma.leaveBalance.findFirst({
        where: { userId, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });

    const made: Array<{ id: string }> = [];
    try {
      // TEST 1 + 4: hired 2025-01-01 → full 2025 year accrues `allotment` by
      // Dec 2025; 8 used → 10 unused → carry min(cap, 10) = 10.
      const used8 = await makeUser("carry.used8@acme.dev", "2025-01-01");
      made.push(used8);
      await add2025Request(used8.id, 8);
      await syncCurrentAccruals(prisma, company.id);
      let row = await currentRow(used8.id);
      assert(row, "2026 row missing for carry.used8");
      assert.equal(row.carriedOver, 10, "8 used / 10 unused must carry 10");

      // TEST 7 + 8: idempotent; sync recomputes accrued independently without
      // zeroing carriedOver or folding it into accrued.
      const accruedBefore = row.accrued;
      await syncCurrentAccruals(prisma, company.id);
      row = await prisma.leaveBalance.findUnique({ where: { id: row.id } });
      assert.equal(row!.carriedOver, 10, "second sync must not change carry-over");
      assert.equal(row!.accrued, accruedBefore, "sync must not rewrite accrued");

      // Year transition (spec #6): planning a request in the NEXT leave year
      // (2027-01-05) rolls the employee's total unused history forward, capped.
      // used8 earned 36 days by Dec 2026, consumed 8 in 2025 → 28 unused → the
      // 2027 carry is min(15, 28) = 15.
      const plan = await resolveBalanceForDate(
        prisma,
        { id: company.id, fiscalYearStartMonth: company.fiscalYearStartMonth },
        { id: used8.id, companyId: company.id, employmentStartDate: "2025-01-01", employmentType: "FULL_TIME" },
        vacation.id,
        { annualAllotment: allotment, carryOverDays: cap },
        "2027-01-05",
      );
      assert(plan && !plan.existing, "expected a planned 2027 balance");
      const earnedThrough2026 = accruedVacationAsOf({
        annualAllotment: allotment,
        employmentStartDate: "2025-01-01",
        asOf: "2026-12-31",
      });
      assert.equal(
        plan.plan.carriedOver,
        Math.min(cap, earnedThrough2026 - 8),
        "2027 plan must carry the total unused history capped at the policy limit",
      );

      // TEST 2: hired 2024-01-01 → 2025 accrual = 1.5 x 24 = 36; 16 used →
      // 20 unused → capped at 15 (never 20).
      const used16 = await makeUser("carry.used16@acme.dev", "2024-01-01");
      made.push(used16);
      await add2025Request(used16.id, 16);
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(used16.id);
      assert(row, "2026 row missing for carry.used16");
      assert.equal(row.carriedOver, 15, "20 unused must be capped at the 15-day limit");

      // TEST 3: hired 2025-01-01, used the whole 2025 allotment → 0 unused → 0.
      const usedAll = await makeUser("carry.usedall@acme.dev", "2025-01-01");
      made.push(usedAll);
      await add2025Request(usedAll.id, 18);
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(usedAll.id);
      assert(row, "2026 row missing for carry.usedall");
      assert.equal(row.carriedOver, 0, "0 unused must carry 0");

      // TEST 6: hired 2025-12-01, no 2025 usage → 2025 accrual 1.5 → 1.5.
      const dec = await makeUser("carry.dec@acme.dev", "2025-12-01");
      made.push(dec);
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(dec.id);
      assert(row, "2026 row missing for carry.dec");
      assert.equal(row.carriedOver, 1.5, "December-2025 hire must carry exactly 1.5");

      // TEST 5: hired 2026-08-01 (brand-new employee) → 0, never the cap.
      const aug = await makeUser("carry.aug@acme.dev", "2026-08-01");
      made.push(aug);
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(aug.id);
      assert(row, "2026 row missing for carry.aug");
      assert.equal(row.carriedOver, 0, "new employee must carry 0");

      // Policy change (spec #15): lowering the limit to 10 re-clamps the
      // current-year carried-over for the 20-unused user; restoring reopens.
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { carryOverDays: 10 } });
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(used16.id);
      assert.equal(row!.carriedOver, 10, "limit lowered to 10 must clamp current carry-over");
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { carryOverDays: cap } });
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(used16.id);
      assert.equal(row!.carriedOver, 15, "limit restored to 15 must reopen the full cap");
    } finally {
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { carryOverDays: cap } }).catch(() => {});
      for (const u of made) {
        await prisma.leaveRequest.deleteMany({ where: { userId: u.id } });
        await prisma.leaveBalance.deleteMany({ where: { userId: u.id } });
        await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: u.id } });
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
      }
    }
  });

  /* ---- carry-over cap applies to TOTAL historical unused, not just the
   * immediately preceding year: 2010 hire → min(lifetime, cap) = cap; and
   * 2024 leftover 10 + 2025 leftover 12 → min(22, cap) = cap (not 12). ---- */
  await check("carry-over: cap covers total eligible unused history (2010 hire + multi-year unused)", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");
    const policy = await prisma.leavePolicy.findFirst({
      where: { companyId: company.id, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
    });
    assert(policy, "no company-wide Vacation policy");
    const cap = policy.carryOverDays;
    const allotment = policy.annualAllotment;
    assert(cap > 0, "seed Vacation policy must have a positive carry-over cap for this check");

    const today = new Date().toISOString().slice(0, 10);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const monthsToToday = (start: string) =>
      (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
      (Number(today.slice(5, 7)) - Number(start.slice(5, 7))) +
      1;

    const makeUser = (email: string, start: string) =>
      createUserForAdmin(superAdmin, {
        name: "Carry Total",
        email,
        role: "EMPLOYEE",
        password: "s3cure-pass-99",
        departmentId: superAdmin.departmentId!,
        employmentStartDate: start,
      });
    const currentRow = (userId: string) =>
      prisma.leaveBalance.findFirst({
        where: { userId, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });

    const made: Array<{ id: string }> = [];
    try {
      // Hired 2010-01-01, never taken a single day → lifetime earned through
      // 2025 is capped at the limit, so carry = cap, NOT the lifetime total.
      // The 2026 row also holds only the per-year 2026 slice → 12 accrued by
      // August + 15 carried-over = 27 available.
      const veteran = await makeUser("carry.2010@acme.dev", "2010-01-01");
      made.push(veteran);
      await syncCurrentAccruals(prisma, company.id);
      let row = await currentRow(veteran.id);
      assert(row, "2026 row missing for carry.2010");
      assert.equal(row.carriedOver, cap, `lifetime unused must be capped at ${cap}, never the lifetime total`);
      const lifetimeAccrued = accruedVacationAsOf({
        annualAllotment: allotment,
        employmentStartDate: "2010-01-01",
        asOf: "2025-12-31",
      });
      assert(row.carriedOver < lifetimeAccrued, "carry must not equal the full lifetime accrual");
      const expected2026Slice = round2((allotment / 12) * monthsToToday("2026-01-01"));
      assert.equal(row.accrued, expected2026Slice, `2010 hire 2026 accrued must be the per-year slice (${expected2026Slice})`);
      assert.equal(
        row.accrued + row.carriedOver + row.adjustment - row.used - row.pending,
        expected2026Slice + cap,
        `2010 hire available must be per-year slice + capped carry (${expected2026Slice} + ${cap})`,
      );

      // Multi-year unused: 2024 leftover 10 (used 8 of 18) + 2025 leftover 12
      // (used 6 of 18) → total 22 → carry min(22, cap) = cap, NOT the 12 the
      // old prior-year-only rule would have carried.
      const multi = await makeUser("carry.multiyear@acme.dev", "2024-01-01");
      made.push(multi);
      await prisma.leaveBalance.createMany({
        data: [
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            periodStart: "2024-01-01",
            periodEnd: "2024-12-31",
            accrued: allotment,
            carriedOver: 0,
            adjustment: 0,
            used: 8,
            pending: 0,
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            periodStart: "2025-01-01",
            periodEnd: "2025-12-31",
            accrued: allotment,
            carriedOver: 0,
            adjustment: 0,
            used: 6,
            pending: 0,
          },
        ],
      });
      await prisma.leaveRequest.createMany({
        data: [
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2024-07-01",
            endDate: "2024-07-31",
            totalDays: 8,
            status: "APPROVED",
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2025-07-01",
            endDate: "2025-07-31",
            totalDays: 6,
            status: "APPROVED",
          },
        ],
      });
      await syncCurrentAccruals(prisma, company.id);
      row = await currentRow(multi.id);
      assert(row, "2026 row missing for carry.multiyear");
      assert.equal(row.carriedOver, cap, `10 + 12 = 22 unused must carry min(22, ${cap}) = ${cap}`);
      assert.notEqual(row.carriedOver, 12, "must not apply the cap to the prior year alone (would carry 12)");
      assert.notEqual(row.carriedOver, 22, "must never carry the uncapped total");
    } finally {
      for (const u of made) {
        await prisma.leaveRequest.deleteMany({ where: { userId: u.id } });
        await prisma.leaveBalance.deleteMany({ where: { userId: u.id } });
        await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: u.id } });
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
      }
    }
  });

  /* ---- Balance history feature: read-only stored rows, newest-first,
   * activity bucketed per leave year, immutable to policy changes, and
   * server-enforced authorization (own history or people-ops within company). ---- */
  await check("balance history: stored rows newest-first, activity bucketed, policy-immutable, authorized", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");
    const policy = await prisma.leavePolicy.findFirst({
      where: { companyId: company.id, leaveTypeId: vacation.id, annualAllotment: { gt: 0 }, departmentId: null },
    });
    assert(policy, "no company-wide Vacation policy");
    const cap = policy.carryOverDays;
    const allotment = policy.annualAllotment;

    const makeUser = (email: string, start: string) =>
      createUserForAdmin(superAdmin, {
        name: "Hist User",
        email,
        role: "EMPLOYEE",
        password: "s3cure-pass-99",
        departmentId: superAdmin.departmentId!,
        employmentStartDate: start,
      });

    let foreign: { companyId: string; userId: string; departmentId: string } | null = null;
    const made: Array<{ id: string }> = [];
    try {
      // Fresh employee: only the current-year row exists, nothing carried,
      // no activity — and the numbers come straight from storage.
      const fresh = await makeUser("hist.fresh@acme.dev", "2026-08-01");
      made.push(fresh);
      const freshHistory = (await balanceHistoryFor(admin, fresh.id)).filter((y) => y.leaveType === vacation.name);
      assert.equal(freshHistory.length, 1, "fresh employee has exactly one vacation balance year");
      const freshStored = await prisma.leaveBalance.findFirst({
        where: { userId: fresh.id, leaveTypeId: vacation.id },
      });
      assert(freshStored, "fresh employee balance row missing");
      assert.equal(freshHistory[0]!.isCurrent, true, "fresh employee row is the current leave year");
      assert.equal(freshHistory[0]!.carriedOver, 0, "fresh employee carries nothing over");
      assert.equal(freshHistory[0]!.accrued, freshStored.accrued, "history accrued must match the stored row");
      assert.equal(freshHistory[0]!.activity.length, 0, "fresh employee has no activity");

      // Employee with three leave years, one request per year, immutability to
      // policy changes, and correct per-year bucketing / ordering.
      const multi = await makeUser("hist.multi@acme.dev", "2024-01-01");
      made.push(multi);
      await prisma.leaveBalance.createMany({
        data: [
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            periodStart: "2024-01-01",
            periodEnd: "2024-12-31",
            accrued: allotment,
            carriedOver: 0,
            adjustment: 0,
            used: 8,
            pending: 0,
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            periodStart: "2025-01-01",
            periodEnd: "2025-12-31",
            accrued: allotment,
            carriedOver: 4,
            adjustment: 0,
            used: 6,
            pending: 0,
          },
        ],
      });
      // The 2026 row is auto-created by createUserForAdmin; pin it to known
      // stored values so the assertions check storage, not a live recompute.
      const currentRow = await prisma.leaveBalance.findFirst({
        where: { userId: multi.id, leaveTypeId: vacation.id, periodStart: "2026-01-01" },
      });
      assert(currentRow, "2026 balance row missing for hist.multi");
      await prisma.leaveBalance.update({
        where: { id: currentRow.id },
        data: { accrued: 12, carriedOver: 5, adjustment: 0, used: 3, pending: 2 },
      });
      await prisma.leaveRequest.createMany({
        data: [
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2024-07-01",
            endDate: "2024-07-31",
            totalDays: 8,
            status: "APPROVED",
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2025-07-01",
            endDate: "2025-07-31",
            totalDays: 6,
            status: "APPROVED",
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2026-02-02",
            endDate: "2026-02-04",
            totalDays: 3,
            status: "APPROVED",
          },
          {
            companyId: company.id,
            userId: multi.id,
            leaveTypeId: vacation.id,
            startDate: "2026-08-01",
            endDate: "2026-08-02",
            totalDays: 2,
            status: "PENDING",
          },
        ],
      });

      const history = (await balanceHistoryFor(admin, multi.id)).filter((y) => y.leaveType === vacation.name);
      assert.equal(history.length, 3, "history must include all three vacation leave years");
      assert.equal(history[0]!.periodStart, "2026-01-01", "newest leave year first");
      assert.equal(history[1]!.periodStart, "2025-01-01", "middle leave year second");
      assert.equal(history[2]!.periodStart, "2024-01-01", "oldest leave year last");
      assert.equal(history[0]!.isCurrent, true, "2026 is the current leave year");
      assert.equal(history[1]!.isCurrent, false, "2025 is not the current leave year");
      assert.equal(history[0]!.accrued, 12, "stored 2026 accrued surfaces unchanged");
      assert.equal(history[0]!.carriedOver, 5, "stored 2026 carriedOver surfaces unchanged");
      assert.equal(history[0]!.used, 3, "stored 2026 used surfaces unchanged");
      assert.equal(history[0]!.pending, 2, "stored 2026 pending surfaces unchanged");
      assert.equal(
        history[0]!.available,
        12 + 5 - 3 - 2,
        "available comes from the stored formula, never recomputed",
      );
      assert.equal(history[0]!.activity.length, 2, "2026 activity = approved + pending request");
      assert.equal(history[0]!.activity[0]!.status, "APPROVED", "2026 activity sorted by start date");
      assert.equal(history[0]!.activity[1]!.status, "PENDING", "2026 activity sorted by start date");
      assert.equal(history[1]!.activity.length, 1, "2025 activity = one approved request");
      assert.equal(history[2]!.activity.length, 1, "2024 activity = one approved request");
      assert.equal(history[1]!.activity[0]!.totalDays, 6, "2025 activity carries the request's day count");

      // A policy change must NOT rewrite what history shows (stored rows).
      const before = JSON.stringify(history);
      await prisma.leavePolicy.update({
        where: { id: policy.id },
        data: { annualAllotment: allotment + 6, carryOverDays: Math.max(1, cap - 5) },
      });
      const after = (await balanceHistoryFor(admin, multi.id)).filter((y) => y.leaveType === vacation.name);
      assert.equal(JSON.stringify(after), before, "policy change must not rewrite historical rows");
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { annualAllotment: allotment, carryOverDays: cap } });

      // Authorization: employees may read only their own history; people-ops
      // may read anyone in their company; nobody may read across companies.
      await assert.rejects(
        () => balanceHistoryFor(employee, multi.id),
        (e) => e instanceof LeaveError,
        "EMPLOYEE must not read another employee's history",
      );
      const own = await balanceHistoryFor(employee, employee.id);
      assert(own.length > 0, "EMPLOYEE can read their own history");
      assert.equal(
        (await balanceHistoryFor(hr, multi.id)).filter((y) => y.leaveType === vacation.name).length,
        3,
        "HR can read any employee in-company",
      );
      await assert.rejects(
        () => balanceHistoryFor(superAdmin, "hist-does-not-exist"),
        (e) => e instanceof LeaveError,
        "nonexistent target must be rejected",
      );

      // Cross-company: a user in a different company is invisible to admin.
      const otherCompany = await prisma.company.create({
        data: { name: "Hist Foreign Co", fiscalYearStartMonth: company.fiscalYearStartMonth },
      });
      const otherDept = await prisma.department.create({
        data: { companyId: otherCompany.id, name: "Foreign" },
      });
      const foreignUser = await prisma.user.create({
        data: {
          companyId: otherCompany.id,
          email: "hist.foreign@elsewhere.dev",
          name: "Foreign Hist",
          departmentId: otherDept.id,
          employmentStartDate: "2026-01-01",
        },
      });
      foreign = { companyId: otherCompany.id, userId: foreignUser.id, departmentId: otherDept.id };
      await assert.rejects(
        () => balanceHistoryFor(admin, foreignUser.id),
        (e) => e instanceof LeaveError,
        "admin must not read history across companies",
      );
    } finally {
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { annualAllotment: allotment, carryOverDays: cap } }).catch(() => {});
      if (foreign) {
        await prisma.user.delete({ where: { id: foreign.userId } }).catch(() => {});
        await prisma.department.delete({ where: { id: foreign.departmentId } }).catch(() => {});
        await prisma.company.delete({ where: { id: foreign.companyId } }).catch(() => {});
      }
      for (const u of made) {
        await prisma.leaveRequest.deleteMany({ where: { userId: u.id } });
        await prisma.leaveBalance.deleteMany({ where: { userId: u.id } });
        await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: u.id } });
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
      }
    }
  });

  /* ---- Bug 1 fix: permanent cascading hard delete ---- */
  await check("hard delete: cascades own rows and nulls references on other users' records", async () => {
    const company = await prisma.company.findFirst();
    assert(company, "seed company not found");
    const vacation = await prisma.leaveType.findFirst({ where: { companyId: company.id, name: "Vacation" } });
    assert(vacation, "seed Vacation leave type not found");

    // Victim: a manager who also acts as approver + delegate.
    const victim = await createUserForAdmin(superAdmin, {
      name: "Delete Victim",
      email: "delete.victim@acme.dev",
      role: "MANAGER",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-01-01",
    });
    // Colleague reports to the victim, has an approved request the victim
    // decided, and a delegation naming the victim as their delegate.
    const colleague = await createUserForAdmin(superAdmin, {
      name: "Delete Colleague",
      email: "delete.colleague@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      managerId: victim.id,
      employmentStartDate: "2026-01-01",
    });
    const victimOwnRequest = await prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        userId: victim.id,
        leaveTypeId: vacation.id,
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        totalDays: 2,
        status: "APPROVED",
      },
    });
    const colleagueRequest = await prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        userId: colleague.id,
        leaveTypeId: vacation.id,
        startDate: "2026-10-01",
        endDate: "2026-10-03",
        totalDays: 3,
        status: "APPROVED",
        approvedById: victim.id,
        approvedAt: new Date(),
        approvalSteps: {
          create: { approverId: victim.id, level: 1, action: "APPROVED" },
        },
      },
    });
    const colleagueDelegation = await prisma.approvalDelegation.create({
      data: {
        companyId: company.id,
        userId: colleague.id,
        delegateId: victim.id,
      },
    });

    try {
      const result = await deleteUserForAdmin(superAdmin, victim.id);
      assert(result.ok, "deleteUserForAdmin must report success");

      // Own rows are gone, user is gone.
      assert.equal(await prisma.user.findUnique({ where: { id: victim.id } }), null, "user must be deleted");
      assert.equal(await prisma.leaveRequest.findUnique({ where: { id: victimOwnRequest.id } }), null, "own request must be deleted");
      assert.equal(
        await prisma.leaveBalance.count({ where: { userId: victim.id } }),
        0,
        "own balances must be deleted",
      );

      // References on the colleague's records are nulled, never deleted.
      const colleagueNow = await prisma.user.findUnique({ where: { id: colleague.id } });
      assert(colleagueNow, "colleague must survive the delete");
      assert.equal(colleagueNow.managerId, null, "managerId must be nulled");
      const colleagueRequestNow = await prisma.leaveRequest.findUnique({
        where: { id: colleagueRequest.id },
        include: { approvalSteps: true },
      });
      assert(colleagueRequestNow, "colleague's request must survive");
      assert.equal(colleagueRequestNow.approvedById, null, "approvedById must be nulled");
      assert.equal(colleagueRequestNow.approvalSteps.length, 1, "approval step must survive");
      assert.equal(colleagueRequestNow.approvalSteps[0]!.approverId, null, "step approverId must be nulled");
      const colleagueDelegationNow = await prisma.approvalDelegation.findUnique({
        where: { id: colleagueDelegation.id },
      });
      assert(colleagueDelegationNow, "colleague's delegation must survive");
      assert.equal(colleagueDelegationNow.delegateId, null, "delegateId must be nulled");

      // An audit trail of the deletion exists (actor kept).
      const trail = await prisma.auditLog.findFirst({
        where: { entityType: "User", entityId: victim.id, action: "user.delete" },
      });
      assert(trail, "deletion must be audited");
      assert.equal(trail.actorId, superAdmin.id, "deletion audit actor must be kept");
    } finally {
      await prisma.leaveRequest.deleteMany({ where: { id: { in: [victimOwnRequest.id, colleagueRequest.id] } } }).catch(() => {});
      await prisma.approvalDelegation.deleteMany({ where: { id: colleagueDelegation.id } }).catch(() => {});
      await prisma.leaveBalance.deleteMany({ where: { userId: { in: [victim.id, colleague.id] } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [colleague.id, victim.id] } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: { in: [victim.id, colleague.id] } } });
    }
  });

  await check("hard delete: HR cannot delete a privileged user, nobody can self-delete", async () => {
    await assert.rejects(
      () => deleteUserForAdmin(hr, admin.id),
      (e) => e instanceof LeaveError && /super_admin/i.test(e.message),
    );
    await assert.rejects(
      () => deleteUserForAdmin(superAdmin, superAdmin.id),
      (e) => e instanceof LeaveError && /own account/i.test(e.message),
    );
  });

  await check("hard delete: OFFBOARDED stays a status change (no rows deleted)", async () => {
    const temp = await createUserForAdmin(superAdmin, {
      name: "Offboard Temp",
      email: "offboard.temp@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-01-01",
    });
    try {
      await updateUserForAdmin(superAdmin, temp.id, { status: "OFFBOARDED" });
      const row = await prisma.user.findUnique({ where: { id: temp.id } });
      assert.equal(row?.status, "OFFBOARDED");
      assert(row, "offboarded user must still exist");
      assert(
        (await prisma.leaveBalance.count({ where: { userId: temp.id } })) > 0,
        "offboarding must not delete balances",
      );
    } finally {
      await prisma.user.delete({ where: { id: temp.id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: temp.id } });
    }
  });

  /* ---- Audit log (RBAC + snapshots + immutability) ---- */
  console.log("\n— Audit log (RBAC + snapshots) —");

  await check("audit: EMPLOYEE/EXECUTIVE cannot read the log, others can", async () => {
    assert.equal(canViewAuditLog(employee), false);
    assert.equal(canViewAuditLog(executive), false);
    assert.equal(canViewAuditLog(admin), true);
    assert.equal(canViewAuditLog(hr), true);
    assert.equal(canViewAuditLog(superAdmin), true);
    assert.equal(canViewAuditLog(lukas), true);
    await assert.rejects(() => listAuditLog(employee), (e) => e instanceof AuditAccessError);
    await assert.rejects(() => listAuditLog(executive), (e) => e instanceof AuditAccessError);
  });

  await check("audit: manager sees own team only; employeeId filter cannot leak", async () => {
    const prodMarker = `audit-seed-prod-${Date.now()}`;
    const engMarker = `audit-seed-eng-${Date.now()}`;
    const felixRow = await prisma.user.findUnique({ where: { id: felix.id }, select: { name: true } });
    const employeeRowName = (await prisma.user.findUnique({ where: { id: employee.id }, select: { name: true } }))?.name;
    assert(felixRow && employeeRowName, "seed users missing");
    try {
      // Event about a Product employee — outside lukas's (Engineering) team.
      await audit(prisma, {
        companyId: superAdmin.companyId!,
        actorId: employee.id,
        action: "user.update",
        entityType: "AuditSeed",
        entityId: prodMarker,
        entityName: employeeRowName,
        employeeId: employee.id,
        metadata: { seed: prodMarker },
      });
      // Event about an Engineering employee — inside lukas's team.
      await audit(prisma, {
        companyId: superAdmin.companyId!,
        actorId: felix.id,
        action: "user.update",
        entityType: "AuditSeed",
        entityId: engMarker,
        entityName: felixRow.name,
        employeeId: felix.id,
        metadata: { seed: engMarker },
      });

      assert.equal((await listAuditLog(admin, { search: prodMarker })).total, 1, "admin must see the Product event");
      assert.equal((await listAuditLog(hr, { search: prodMarker })).total, 1, "HR must see the Product event");
      assert.equal((await listAuditLog(superAdmin, { search: prodMarker })).total, 1, "SUPER_ADMIN must see the Product event");
      assert.equal((await listAuditLog(lukas, { search: engMarker })).total, 1, "manager must see own-team event");
      assert.equal((await listAuditLog(lukas, { search: prodMarker })).total, 0, "manager must NOT see the Product event");
      // A guessed employeeId outside the team must not widen the manager view.
      assert.equal(
        (await listAuditLog(lukas, { employeeId: employee.id, search: prodMarker })).total,
        0,
        "manager must not leak Product rows via employeeId filter",
      );
      // Company-wide roles can filter by employee.
      assert.equal(
        (await listAuditLog(admin, { employeeId: employee.id, search: prodMarker })).total,
        1,
        "admin employeeId filter must match",
      );
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [prodMarker, engMarker] } } });
    }
  });

  await check("audit: snapshots auto-resolve and survive deletion", async () => {
    const temp = await createUserForAdmin(superAdmin, {
      name: "Audit Victim",
      email: "audit.victim@acme.dev",
      role: "EMPLOYEE",
      password: "s3cure-pass-99",
      departmentId: superAdmin.departmentId!,
      employmentStartDate: "2026-01-01",
    });
    try {
      await audit(prisma, {
        companyId: superAdmin.companyId!,
        actorId: superAdmin.id,
        action: "user.create",
        entityType: "User",
        entityId: temp.id,
      });
      const row = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: temp.id, action: "user.create" } });
      assert(row, "create event must be logged");
      assert.equal(row.actorNameSnapshot, superAdmin.name, "actor snapshot must auto-resolve");
      assert.equal(row.entityNameSnapshot, "Audit Victim", "entity snapshot must auto-resolve");
      assert.equal(row.employeeId, temp.id, "employeeId must auto-resolve for User targets");

      await deleteUserForAdmin(superAdmin, temp.id);
      const after = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: temp.id, action: "user.create" } });
      assert(after, "create event must survive the user deletion");
      assert.equal(after.entityNameSnapshot, "Audit Victim", "entity snapshot must survive deletion");
      assert.equal(after.employeeId, temp.id, "employeeId must survive deletion");
      const del = await prisma.auditLog.findFirst({ where: { entityType: "User", entityId: temp.id, action: "user.delete" } });
      assert(del, "deletion must be audited");
      assert.equal(del.actorId, superAdmin.id, "deletion audit actor must be kept");
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: temp.id } });
      await prisma.user.deleteMany({ where: { id: temp.id } }).catch(() => {});
    }
  });

  await check("audit: sensitive fields are never stored", async () => {
    const marker = `audit-secret-${Date.now()}`;
    try {
      await audit(prisma, {
        companyId: superAdmin.companyId!,
        actorId: superAdmin.id,
        action: "user.update",
        entityType: "User",
        entityId: marker,
        employeeId: superAdmin.id,
        metadata: {
          note: "keep me",
          password: "hunter2",
          passwordHash: "hash-abc",
          apiKey: "sk-live-123",
          authToken: "tok",
          session: "sess",
          safe: { nested: "value", secret: "nope" },
        },
      });
      const row = await prisma.auditLog.findFirst({ where: { entityId: marker } });
      assert(row, "row must exist");
      const stored = JSON.stringify(row.metadata);
      assert(stored.includes("keep me"), "non-sensitive data must be kept");
      assert(!/hunter2|hash-abc|sk-live-123|"tok"|"sess"|"nope"/.test(stored), "secrets must be stripped");
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityId: marker } });
    }
  });

  await check("audit: system events carry no actor", async () => {
    const marker = `audit-sys-${Date.now()}`;
    try {
      await audit(prisma, {
        companyId: superAdmin.companyId!,
        actorId: null,
        action: "balance.sync",
        entityType: "LeaveBalance",
        entityId: marker,
        employeeId: employee.id,
      });
      const row = await prisma.auditLog.findFirst({ where: { entityId: marker } });
      assert(row, "row must exist");
      assert.equal(row.actorId, null, "system event must have no actor id");
      assert.equal(row.actorNameSnapshot, null, "system event must have no actor name");
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityId: marker } });
    }
  });

  await check("audit: balance.sync is only written when values actually change", async () => {
    const company = await prisma.company.findFirst({ select: { id: true } });
    assert(company, "seed company missing");
    await syncCurrentAccruals(prisma, company.id);
    const before = await prisma.auditLog.count({
      where: { action: "balance.sync", metadata: { path: ["source"], equals: "accrual-sync" } },
    });
    await syncCurrentAccruals(prisma, company.id);
    const after = await prisma.auditLog.count({
      where: { action: "balance.sync", metadata: { path: ["source"], equals: "accrual-sync" } },
    });
    assert.equal(after, before, "a no-op sync must not append audit entries");
  });

  /* ---- Dashboard crash regression (stale companyId) ---- */
  await check("accrual engine stays strict: a nonexistent companyId fails loudly (not swallowed)", async () => {
    await assert.rejects(
      () => syncCurrentAccruals(prisma, "cmsrj9u370000novs50epz7vs-does-not-exist"),
      (e: unknown) => (e as { code?: string } | null)?.code === "P2025",
    );
  });
  await check("data integrity: every user's company exists (no orphaned companyId)", async () => {
    const companyIds = new Set((await prisma.company.findMany({ select: { id: true } })).map((c) => c.id));
    const userIds = await prisma.user.findMany({ select: { companyId: true } });
    assert(companyIds.size > 0, "seed company missing");
    for (const row of userIds) {
      assert(companyIds.has(row.companyId), `user references a company that does not exist: ${row.companyId}`);
    }
  });

  /* ---- Holiday management + Nager import ---- */
  console.log("\n— Holiday management & Nager import —");

  // A guaranteed weekday for the counting checks below (computed in UTC so no
  // local-timezone shift can turn it into a Sunday).
  const smokeBase = new Date(Date.UTC(2030, 5, 24));
  while (smokeBase.getUTCDay() === 0 || smokeBase.getUTCDay() === 6) smokeBase.setUTCDate(smokeBase.getUTCDate() + 1);
  const smokeDate = smokeBase.toISOString().slice(0, 10);
  const smokeName = `Smoke Holiday ${Date.now()}`;

  await check("holiday CRUD requires HR/ADMIN", async () => {
    await assert.rejects(() => listHolidaysForAdmin(employee), (e: unknown) => e instanceof LeaveError);
    await assert.rejects(
      () => createHolidayForAdmin(employee, { name: smokeName, date: smokeDate }),
      (e: unknown) => e instanceof LeaveError,
    );
    await assert.rejects(
      () => updateHolidayForAdmin(employee, "nope", { name: smokeName, date: smokeDate }),
      (e: unknown) => e instanceof LeaveError,
    );
    await assert.rejects(
      () => deleteHolidayForAdmin(employee, "nope"),
      (e: unknown) => e instanceof LeaveError,
    );
  });

  let createdId = "";
  await check("HR creates a manual holiday (source MANUAL)", async () => {
    const holiday = await createHolidayForAdmin(hr, {
      name: smokeName,
      date: smokeDate,
      holidayTypes: ["Public"],
    });
    createdId = holiday.id;
    assert.equal(holiday.source, "MANUAL");
    assert.equal(holiday.global, false);
    assert.deepEqual(holiday.holidayTypes, ["Public"]);
  });

  await check("duplicate date in the same company is rejected (unique companyId+date)", async () => {
    await assert.rejects(
      () => createHolidayForAdmin(hr, { name: smokeName, date: smokeDate }),
      (e: unknown) => e instanceof LeaveError && e.code === "holidayDateExists",
    );
  });

  await check("holiday appears in calendar/vacation integration (companyHolidays)", async () => {
    const holidays = await companyHolidays(prisma, hr.companyId!, "2030-01-01", "2030-12-31");
    assert(holidays.has(smokeDate), "created holiday must appear in companyHolidays");
  });

  await check("a weekday holiday counts as a vacation day only when the setting is on", async () => {
    const dayAfter = new Date(new Date(`${smokeDate}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const span = { startDate: smokeDate, endDate: dayAfter, startDayPart: "FULL", endDayPart: "FULL" } as const;
    const opts = { holidays: new Set([smokeDate]), countWeekendsWithinSpan: false, extendWeekendAfterFriday: false };
    const on = computeLeaveDays(span, { ...opts, countHolidaysAsVacationDays: true });
    const off = computeLeaveDays(span, { ...opts, countHolidaysAsVacationDays: false });
    assert.equal(on.totalDays, 2, "holiday must count as a vacation day when enabled");
    assert.equal(off.totalDays, 1, "holiday must be free when disabled");
  });

  await check("holidays are company-scoped and unreachable across companies", async () => {
    const other = await prisma.company.create({ data: { name: `Smoke Corp ${Date.now()}`, countryCode: "FR" } });
    const otherHoliday = await prisma.holiday.create({
      data: { companyId: other.id, countryCode: "FR", name: "Other Co holiday", date: "2030-07-14" },
    });
    try {
      const list = await listHolidaysForAdmin(hr);
      assert(!list.some((h) => h.companyId === other.id), "HR must not see another company's holidays");
      await assert.rejects(
        () => updateHolidayForAdmin(hr, otherHoliday.id, { name: "x", date: "2030-07-14" }),
        (e: unknown) => e instanceof LeaveError && e.code === "holidayNotFound",
      );
      await assert.rejects(
        () => deleteHolidayForAdmin(hr, otherHoliday.id),
        (e: unknown) => e instanceof LeaveError && e.code === "holidayNotFound",
      );
    } finally {
      await prisma.holiday.deleteMany({ where: { companyId: other.id } });
      await prisma.company.delete({ where: { id: other.id } });
    }
  });

  await check("HR edits a holiday; clash check ignores the row itself", async () => {
    const updated = await updateHolidayForAdmin(hr, createdId, { name: `${smokeName} renamed`, date: "2030-12-25" });
    assert.equal(updated.name, `${smokeName} renamed`);
    assert.equal(updated.date, "2030-12-25");
    const back = await updateHolidayForAdmin(hr, createdId, { name: smokeName, date: smokeDate });
    assert.equal(back.date, smokeDate);
  });

  await check("deleting a holiday removes it from calendars", async () => {
    await deleteHolidayForAdmin(hr, createdId);
    const holidays = await companyHolidays(prisma, hr.companyId!, "2030-01-01", "2030-12-31");
    assert(!holidays.has(smokeDate), "deleted holiday must not appear anymore");
  });

  const realFetch = globalThis.fetch;
  const stubNager = (payload: unknown, status = 200) => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://date.nager.at/api/v4/Holidays/")) {
        return new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }) as typeof fetch;
  };

  try {
    // 2031 avoids every date the seed already inserts for DE (2025/2026).
    const importPayload = [
      { date: "2031-01-01", name: "New Year's Day", countryCode: "DE", fixed: true, global: true, types: ["Public"] },
      { date: "2031-04-18", name: "Good Friday", countryCode: "DE", fixed: false, global: true, types: ["Public"] },
      { date: "2031-05-01", name: "Labour Day", countryCode: "DE", fixed: false, global: true, types: ["Public"] },
      { date: "2031-11-19", name: "Repentance Day", countryCode: "DE", fixed: false, global: false, types: ["Public"] },
    ];
    const importDates = ["2031-01-01", "2031-04-18", "2031-05-01", "2031-11-19"];
    stubNager(importPayload);

    await check("Nager import creates the missing holidays and audits one summary event", async () => {
      const res = await importNagerHolidaysForAdmin(hr, {
        countryCode: "DE",
        year: 2031,
        selectedDates: importDates,
      });
      assert.equal(res.fetched, 4);
      assert.equal(res.selected, 4);
      assert.equal(res.created, 4);
      assert.equal(res.existing, 0);
      assert.equal(res.skipped, 0);
      const rows = await prisma.holiday.findMany({ where: { companyId: hr.companyId!, date: { in: importDates } } });
      assert.equal(rows.length, 4, "all four selected holidays must be created");
      assert(rows.every((r) => r.source === "NAGER_DATE"), "imported rows must be marked NAGER_DATE");
      const auditRow = await prisma.auditLog.findFirst({
        where: { companyId: hr.companyId!, action: "holiday.import", entityNameSnapshot: "DE 2031" },
        orderBy: { createdAt: "desc" },
      });
      assert(auditRow, "import must write a summary audit event");
    });

    await check("re-import is idempotent: nothing new, nothing overwritten", async () => {
      const res = await importNagerHolidaysForAdmin(hr, {
        countryCode: "DE",
        year: 2031,
        selectedDates: importDates,
      });
      assert.equal(res.created, 0);
      assert.equal(res.existing, 4);
      assert.equal(res.skipped, 0);
    });

    await check("re-import never overwrites a manual edit", async () => {
      const row = await prisma.holiday.findFirst({ where: { companyId: hr.companyId!, date: "2031-01-01" } });
      assert(row, "imported row must exist");
      await prisma.holiday.update({ where: { id: row.id }, data: { name: "Manual New Year" } });
      const res = await importNagerHolidaysForAdmin(hr, { countryCode: "DE", year: 2031, selectedDates: ["2031-01-01"] });
      assert.equal(res.created, 0);
      assert.equal(res.existing, 1);
      const after = await prisma.holiday.findFirst({ where: { id: row.id } });
      assert.equal(after?.name, "Manual New Year", "manual edit must be preserved");
    });

    await check("stale selection dates are reported as skipped", async () => {
      const res = await importNagerHolidaysForAdmin(hr, {
        countryCode: "DE",
        year: 2031,
        selectedDates: ["2031-05-01", "1999-01-01"],
      });
      assert.equal(res.existing, 1);
      assert.equal(res.skipped, 1);
    });

    await check("import requires HR and a non-empty selection", async () => {
      await assert.rejects(
        () => importNagerHolidaysForAdmin(employee, { countryCode: "DE", year: 2031, selectedDates: ["2031-01-01"] }),
        (e: unknown) => e instanceof LeaveError,
      );
      await assert.rejects(
        () => importNagerHolidaysForAdmin(hr, { countryCode: "DE", year: 2031, selectedDates: [] }),
        (e: unknown) => e instanceof LeaveError && e.code === "nagerNoSelection",
      );
    });

    await check("invalid country/year are rejected before any network call", async () => {
      let called = false;
      globalThis.fetch = (async () => {
        called = true;
        return new Response("x", { status: 500 });
      }) as typeof fetch;
      await assert.rejects(
        () => importNagerHolidaysForAdmin(hr, { countryCode: "DE1", year: 2031, selectedDates: ["2031-01-01"] }),
        (e: unknown) => (e as { code?: string }).code === "nagerInvalidCountry",
      );
      await assert.rejects(
        () => importNagerHolidaysForAdmin(hr, { countryCode: "DE", year: 1899, selectedDates: ["2031-01-01"] }),
        (e: unknown) => (e as { code?: string }).code === "nagerInvalidYear",
      );
      assert.equal(called, false, "network must not be hit for invalid input");
    });

    await check("Nager empty responses map to nagerNoHolidays", async () => {
      stubNager([], 200);
      await assert.rejects(
        () => importNagerHolidaysForAdmin(hr, { countryCode: "DE", year: 2027, selectedDates: ["2027-01-01"] }),
        (e: unknown) => e instanceof LeaveError && e.code === "nagerNoHolidays",
      );
    });

    await check("country code is normalized (de → DE)", async () => {
      stubNager(importPayload);
      const res = await importNagerHolidaysForAdmin(hr, { countryCode: "de", year: 2031, selectedDates: ["2031-05-01"] });
      assert.equal(res.countryCode, "DE");
      assert.equal(res.existing, 1);
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  await check("manual holiday ops write create/update/delete audit events", async () => {
    const created = await createHolidayForAdmin(hr, { name: `${smokeName} audit`, date: "2030-08-15" });
    const updated = await updateHolidayForAdmin(hr, created.id, { name: `${smokeName} audit 2`, date: "2030-08-15" });
    await deleteHolidayForAdmin(hr, created.id);
    const actions = await prisma.auditLog.findMany({
      where: { companyId: hr.companyId!, entityType: "Holiday", entityId: created.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(updated.name, `${smokeName} audit 2`);
    assert.deepEqual(
      actions.map((a) => a.action),
      ["holiday.create", "holiday.update", "holiday.delete"],
    );
  });

  // Cleanup: remove every row this section created (holiday rows + audit trail).
  await prisma.holiday.deleteMany({
    where: {
      companyId: hr.companyId!,
      date: { in: ["2031-01-01", "2031-04-18", "2031-05-01", "2031-11-19", smokeDate, "2030-12-25", "2030-08-15"] },
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      companyId: hr.companyId!,
      action: { in: ["holiday.create", "holiday.update", "holiday.delete", "holiday.import"] },
    },
  });

  console.log(`\n${checks} checks, ${failures} failures.`);
  if (failures > 0) process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
