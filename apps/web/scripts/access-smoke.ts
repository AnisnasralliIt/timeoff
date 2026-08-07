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
import type { SessionUser } from "../lib/session";
import type { CalendarLeave, CalendarRosterMember, RequestStatus } from "../lib/calendar-shared";
import {
  getVisibleUserIds,
  getUserScope,
  resolveDepartmentId,
  canGrantRole,
} from "../lib/permissions";
import {
  listPendingForApproval,
  canUserDecide,
  decideLeaveRequest,
  createDelegation,
  deactivateDelegation,
  listDelegationCandidates,
  LeaveError,
} from "../lib/services/leave";
import {
  createUserForAdmin,
  updateUserForAdmin,
} from "../lib/services/admin";
import { canViewRequest } from "../lib/services/attachments";
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

  // A regular employee (first ACTIVE user that is not an approver).
  const employeeRow = await prisma.user.findFirst({
    where: { status: "ACTIVE", role: "EMPLOYEE", department: { name: "Product" } },
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
