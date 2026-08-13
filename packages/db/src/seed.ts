/**
 * Dev seed: a realistic 42-person company ("Acme GmbH", countryCode DE) with a
 * year of leave history, current balances, and approval rules. Deterministic
 * (seeded PRNG) so re-seeding reproduces the same data. All users authenticate
 * with the shared dev password below.
 */
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { computeLeaveDays, addDaysISO, accruedVacationAsOf, cappedCarryOver, todayISO, parseISO, type DayPart } from "@timeoff/domain";
import { prisma } from "./client";

const COMPANY_NAME = "Acme GmbH";
const COMPANY_DOMAIN = "acme.dev";
const DEV_PASSWORD = "password123";
const LEAVE_YEAR_START = "2026-01-01";
const LEAVE_YEAR_END = "2026-12-31";
const ANNUAL_ALLOTMENT = 18;
const CARRY_OVER_DAYS = 15;

const HOLIDAYS: Record<string, Array<{ date: string; name: string }>> = {
  "2025": [
    { date: "2025-01-01", name: "Neujahr" },
    { date: "2025-04-18", name: "Karfreitag" },
    { date: "2025-04-21", name: "Ostermontag" },
    { date: "2025-05-01", name: "Tag der Arbeit" },
    { date: "2025-05-29", name: "Christi Himmelfahrt" },
    { date: "2025-06-09", name: "Pfingstmontag" },
    { date: "2025-10-03", name: "Tag der Deutschen Einheit" },
    { date: "2025-12-25", name: "1. Weihnachtstag" },
    { date: "2025-12-26", name: "2. Weihnachtstag" },
  ],
  "2026": [
    { date: "2026-01-01", name: "Neujahr" },
    { date: "2026-04-03", name: "Karfreitag" },
    { date: "2026-04-06", name: "Ostermontag" },
    { date: "2026-05-01", name: "Tag der Arbeit" },
    { date: "2026-05-14", name: "Christi Himmelfahrt" },
    { date: "2026-05-25", name: "Pfingstmontag" },
    { date: "2026-10-03", name: "Tag der Deutschen Einheit" },
    { date: "2026-12-25", name: "1. Weihnachtstag" },
    { date: "2026-12-26", name: "2. Weihnachtstag" },
  ],
};

function holidaySet(year: string): ReadonlySet<string> {
  return new Set(HOLIDAYS[year]!.map((h) => h.date));
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20_260_805);
function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}
function chance(p: number): boolean {
  return rng() < p;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}
function parseDayDate(value: string): Date {
  return parseISO(value);
}

function randomWeekdayStart(min: string, max: string, holidays: ReadonlySet<string>): string {
  const minMs = parseISO(min).getTime();
  const maxMs = parseISO(max).getTime();
  for (let i = 0; i < 30; i++) {
    const ms = minMs + rng() * (maxMs - minMs);
    const candidate = new Date(ms);
    const day = candidate.getDay();
    const candidateISO = isoDate(candidate.getFullYear(), candidate.getMonth() + 1, candidate.getDate());
    if (day !== 0 && day !== 6 && !holidays.has(candidateISO)) {
      return candidateISO;
    }
  }
  throw new Error(`Could not find a working day between ${min} and ${max}`);
}

function addBusinessDays(start: string, n: number, holidays: ReadonlySet<string>, maxEnd: string): string {
  let cursor = start;
  let added = 0;
  while (added < n) {
    cursor = addDaysISO(cursor, 1);
    if (cursor > maxEnd) break;
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(cursor)) added++;
  }
  return cursor;
}

const FIRST_NAMES = [
  "Emma", "Noah", "Mia", "Liam", "Sofia", "Lena", "Felix", "Amelie", "Elias", "Hannah",
  "Lukas", "Clara", "Matteo", "Paula", "Ben", "Marie", "Finn", "Ida", "Leon", "Greta",
  "Timo", "Nora", "Paul", "Frida", "Max", "Lina", "Anton", "Ella", "Karl", "Eva",
];
const LAST_NAMES = [
  "Weber", "Mueller", "Schmidt", "Schneider", "Fischer", "Meyer", "Wagner", "Becker",
  "Hoffmann", "Schulz", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Neumann",
  "Schwarz", "Zimmermann", "Braun", "Krueger",
];

const VACATION_REASONS = ["Annual leave", "Family holiday", "Trip abroad", "Recovery week", "Booking trip"];
const SICK_REASONS = ["Unwell", "Doctor's visit", "Flu", "Migraine"];
const PERSONAL_REASONS = ["Moving", "Personal errand", "Family matters", "Home repair"];
const REJECTION_REASONS = ["Coverage conflict in the team that week", "Too many people off already", "Project deadline conflict"];

type DeptName = "Engineering" | "Product" | "Design" | "Operations";
type RoleName = "SUPER_ADMIN" | "HR" | "ADMIN" | "MANAGER" | "EXECUTIVE" | "EMPLOYEE";
type RequestStatus = "APPROVED" | "PENDING" | "REJECTED";

interface Person {
  firstName: string;
  lastName: string;
  email: string;
  role: RoleName;
  department: DeptName;
  title: string;
  startDate: string;
  managerEmail: string | null;
}

interface RequestDraft {
  type: "VACATION" | "SICK" | "PERSONAL";
  startDate: string;
  endDate: string;
  startDayPart: DayPart;
  endDayPart: DayPart;
  status: RequestStatus;
  reason?: string;
  approverEmail?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

interface PersonDraft extends Person {
  requests: RequestDraft[];
}

const usedEmails = new Set<string>();
let nameCursor = 0;

function makeEmail(firstName: string, lastName: string): string {
  const base = `${firstName}.${lastName}@${COMPANY_DOMAIN}`.toLowerCase();
  if (!usedEmails.has(base)) {
    usedEmails.add(base);
    return base;
  }
  let i = 2;
  while (usedEmails.has(`${base.split("@")[0]}${i}@${COMPANY_DOMAIN}`)) i++;
  const email = `${base.split("@")[0]}${i}@${COMPANY_DOMAIN}`;
  usedEmails.add(email);
  return email;
}

function nextGeneratedName(): [string, string] {
  const firstName = FIRST_NAMES[Math.floor(nameCursor / LAST_NAMES.length) % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[nameCursor % LAST_NAMES.length]!;
  nameCursor++;
  return [firstName, lastName];
}

function randomStartDate(): string {
  if (chance(0.1)) {
    return isoDate(2026, randInt(1, 6), randInt(1, 28));
  }
  return isoDate(randInt(2020, 2025), randInt(1, 12), randInt(1, 28));
}

function buildPerson(
  firstName: string,
  lastName: string,
  role: RoleName,
  department: DeptName,
  title: string,
  startDate: string,
  managerEmail: string | null,
): Omit<Person, "email"> & { email: string } {
  return { firstName, lastName, email: makeEmail(firstName, lastName), role, department, title, startDate, managerEmail };
}

function genRequests(p: Person): RequestDraft[] {
  const requests: RequestDraft[] = [];
  const holiday25 = holidaySet("2025");
  const holiday26 = holidaySet("2026");

  // 2025 history (all approved, in the past).
  const summerStart = randomWeekdayStart("2025-06-02", "2025-07-15", holiday25);
  const summerEnd = addBusinessDays(summerStart, randInt(9, 14), holiday25, "2025-09-01");
  requests.push({
    type: "VACATION",
    startDate: summerStart,
    endDate: summerEnd,
    startDayPart: "FULL",
    endDayPart: "FULL",
    status: "APPROVED",
    reason: pick(VACATION_REASONS),
    approverEmail: p.managerEmail ?? undefined,
    approvedAt: addDaysISO(summerStart, -3),
  });

  if (chance(0.85)) {
    const autumnStart = randomWeekdayStart("2025-09-15", "2025-10-20", holiday25);
    const autumnEnd = addBusinessDays(autumnStart, randInt(4, 7), holiday25, "2025-11-15");
    requests.push({
      type: "VACATION",
      startDate: autumnStart,
      endDate: autumnEnd,
      startDayPart: "FULL",
      endDayPart: "FULL",
      status: "APPROVED",
      reason: pick(VACATION_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(autumnStart, -2),
    });
  }

  if (chance(0.7)) {
    const sickStart = chance(0.5)
      ? randomWeekdayStart("2025-02-01", "2025-05-31", holiday25)
      : randomWeekdayStart("2025-11-01", "2025-12-15", holiday25);
    const sickEnd = addBusinessDays(sickStart, randInt(0, 2), holiday25, "2025-12-15");
    requests.push({
      type: "SICK",
      startDate: sickStart,
      endDate: sickEnd,
      startDayPart: "FULL",
      endDayPart: "FULL",
      status: "APPROVED",
      reason: pick(SICK_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(sickStart, -1),
    });
  }

  if (chance(0.4)) {
    const personalStart = chance(0.5)
      ? randomWeekdayStart("2025-01-10", "2025-05-31", holiday25)
      : randomWeekdayStart("2025-11-01", "2025-12-10", holiday25);
    requests.push({
      type: "PERSONAL",
      startDate: personalStart,
      endDate: personalStart,
      startDayPart: "FULL",
      endDayPart: "FULL",
      status: "APPROVED",
      reason: pick(PERSONAL_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(personalStart, -1),
    });
  }

  // 2026 (current leave year).
  if (chance(0.9)) {
    const earlyStart = randomWeekdayStart("2026-01-15", "2026-03-10", holiday26);
    const earlyEnd = addBusinessDays(earlyStart, randInt(2, 7), holiday26, "2026-04-01");
    requests.push({
      type: "VACATION",
      startDate: earlyStart,
      endDate: earlyEnd,
      startDayPart: "FULL",
      endDayPart: "FULL",
      status: "APPROVED",
      reason: pick(VACATION_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(earlyStart, -2),
    });
  }

  requests.push({
    type: "VACATION",
    startDate: randomWeekdayStart("2026-06-15", "2026-08-05", holiday26),
    endDate: "", // filled below
    startDayPart: "FULL",
    endDayPart: "FULL",
    status: "PENDING",
    reason: pick(VACATION_REASONS),
  });
  const pending = requests[requests.length - 1]!;
  pending.endDate = addBusinessDays(pending.startDate, randInt(6, 14), holiday26, "2026-09-01");

  if (chance(0.2)) {
    const rejectedStart = randomWeekdayStart("2026-09-01", "2026-11-10", holiday26);
    const rejectedEnd = addBusinessDays(rejectedStart, randInt(2, 5), holiday26, "2026-12-15");
    requests.push({
      type: "VACATION",
      startDate: rejectedStart,
      endDate: rejectedEnd,
      startDayPart: "FULL",
      endDayPart: "FULL",
      status: "REJECTED",
      reason: pick(VACATION_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(rejectedStart, -5),
      rejectionReason: pick(REJECTION_REASONS),
    });
  }

  if (chance(0.25)) {
    const halfStart = randomWeekdayStart("2026-05-15", "2026-06-10", holiday26);
    const part: DayPart = chance(0.5) ? "FIRST_HALF" : "SECOND_HALF";
    requests.push({
      type: "PERSONAL",
      startDate: halfStart,
      endDate: halfStart,
      startDayPart: part,
      endDayPart: part,
      status: "APPROVED",
      reason: pick(PERSONAL_REASONS),
      approverEmail: p.managerEmail ?? undefined,
      approvedAt: addDaysISO(halfStart, -1),
    });
  }

  return requests.filter((r) => r.startDate && r.endDate && r.startDate >= p.startDate);
}

function computeTotalDays(req: RequestDraft): { totalDays: number; days: Array<{ date: string; dayPart: DayPart }> } {
  const year = req.startDate.slice(0, 4);
  const computed = computeLeaveDays(
    { startDate: req.startDate, endDate: req.endDate, startDayPart: req.startDayPart, endDayPart: req.endDayPart },
    { holidays: holidaySet(year) },
  );
  return { totalDays: computed.totalDays, days: computed.days };
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const people: Person[] = [
    buildPerson("Anna", "Klein", "SUPER_ADMIN", "Operations", "Chief Executive Officer", "2019-05-01", null),
    buildPerson("Sofia", "Braun", "ADMIN", "Operations", "People Operations Manager", "2022-04-11", "anna.klein@acme.dev"),
    buildPerson("Robert", "Schmidt", "EXECUTIVE", "Operations", "Chief Financial Officer", "2019-09-01", "anna.klein@acme.dev"),
    buildPerson("Julia", "Hoffmann", "HR", "Operations", "Head of People", "2021-03-15", "anna.klein@acme.dev"),
    buildPerson("Lukas", "Fischer", "MANAGER", "Engineering", "Engineering Lead", "2020-01-06", "anna.klein@acme.dev"),
    buildPerson("Emma", "Klein", "MANAGER", "Product", "Product Lead", "2020-06-01", "anna.klein@acme.dev"),
    buildPerson("Lena", "Schneider", "MANAGER", "Design", "Design Lead", "2021-02-01", "anna.klein@acme.dev"),
    buildPerson("Jonas", "Meyer", "MANAGER", "Operations", "Operations Lead", "2020-09-01", "anna.klein@acme.dev"),
    buildPerson("Felix", "Wagner", "MANAGER", "Engineering", "Team Lead, Platform", "2021-07-01", "lukas.fischer@acme.dev"),
    buildPerson("Clara", "Becker", "MANAGER", "Engineering", "Team Lead, Web", "2022-01-10", "lukas.fischer@acme.dev"),
  ];

  const fillers: Array<{ dept: DeptName; count: number }> = [
    { dept: "Engineering", count: 10 },
    { dept: "Product", count: 8 },
    { dept: "Design", count: 5 },
    { dept: "Operations", count: 9 },
  ];

  const titles: Record<DeptName, string> = {
    Engineering: "Software Engineer",
    Product: "Product Manager",
    Design: "Product Designer",
    Operations: "Operations Specialist",
  };

  for (const { dept, count } of fillers) {
    for (let i = 0; i < count; i++) {
      const [firstName, lastName] = nextGeneratedName();
      const managerEmail =
        dept === "Engineering" ? (i % 2 === 0 ? "felix.wagner@acme.dev" : "clara.becker@acme.dev") : `${dept === "Product" ? "emma.klein" : dept === "Design" ? "lena.schneider" : "jonas.meyer"}@acme.dev`;
      people.push(
        buildPerson(firstName, lastName, "EMPLOYEE", dept, titles[dept], randomStartDate(), managerEmail),
      );
    }
  }

  const drafts: PersonDraft[] = people.map((p) => ({ ...p, requests: genRequests(p) }));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Reset in dependency order.
    await tx.approvalStep.deleteMany();
    await tx.leaveRequestDay.deleteMany();
    await tx.leaveRequest.deleteMany();
    await tx.leaveBalance.deleteMany();
    await tx.notification.deleteMany();
    await tx.approvalRule.deleteMany();
    await tx.approvalDelegation.deleteMany();
    await tx.holiday.deleteMany();
    await tx.leavePolicy.deleteMany();
    await tx.leaveType.deleteMany();
    await tx.user.deleteMany();
    await tx.department.deleteMany();
    await tx.company.deleteMany();

    const company = await tx.company.create({
      data: {
        name: COMPANY_NAME,
        domain: COMPANY_DOMAIN,
        countryCode: "DE",
        timezone: "Europe/Berlin",
        fiscalYearStartMonth: 1,
      },
    });

    const departments = new Map<DeptName, string>();
    for (const name of ["Engineering", "Product", "Design", "Operations"] as DeptName[]) {
      const dept = await tx.department.create({
        data: { companyId: company.id, name, code: name.slice(0, 3).toUpperCase(), sortOrder: departments.size },
      });
      departments.set(name, dept.id);
    }

    const leaveTypes = new Map<string, string>();
    for (const type of [
      { key: "VACATION", name: "Vacation", color: "#2e9486", sortOrder: 0 },
      { key: "SICK", name: "Sick Leave", color: "#e07b5a", sortOrder: 1, requiresApproval: false },
      { key: "PERSONAL", name: "Personal", color: "#d9a441", sortOrder: 2 },
    ]) {
      const created = await tx.leaveType.create({
        data: {
          companyId: company.id,
          name: type.name,
          color: type.color,
          sortOrder: type.sortOrder,
          requiresApproval: type.requiresApproval ?? true,
          isSystem: true,
        },
      });
      leaveTypes.set(type.key, created.id);
    }

    for (const typeKey of ["VACATION", "SICK", "PERSONAL"]) {
      const policyName =
        typeKey === "VACATION" ? "Company-wide Vacation Policy" : `${typeKey === "SICK" ? "Sick Leave" : "Personal"} Policy`;
      await tx.leavePolicy.create({
        data: {
          companyId: company.id,
          name: policyName,
          leaveTypeId: leaveTypes.get(typeKey)!,
          annualAllotment: typeKey === "VACATION" ? ANNUAL_ALLOTMENT : 0,
          carryOverDays: typeKey === "VACATION" ? CARRY_OVER_DAYS : 0,
          // Carried-over days are usable until the end of the leave year they
          // are granted into (L4); the engine enforces the configured MM-DD.
          carryOverExpiresOn: typeKey === "VACATION" ? "12-31" : null,
          negativeAllowed: false,
          probationDays: typeKey === "VACATION" ? 30 : 0,
        },
      });
    }

    for (const items of Object.values(HOLIDAYS)) {
      for (const h of items) {
        await tx.holiday.create({
          data: { companyId: company.id, countryCode: "DE", name: h.name, date: h.date, isRecurring: false },
        });
      }
    }

    // Multi-level chain: manager → skip-level (Engineering only) → HR review.
    await tx.approvalRule.createMany({
      data: [
        { companyId: company.id, name: "Direct manager", kind: "MANAGER", level: 1, active: true },
        {
          companyId: company.id,
          name: "Engineering skip-level",
          kind: "MANAGERS_MANAGER",
          level: 2,
          departmentId: departments.get("Engineering")!,
          active: true,
        },
        { companyId: company.id, name: "HR review", kind: "HR", level: 3, active: true },
      ],
    });

    const userIds = new Map<string, string>();
    for (const p of drafts) {
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email: p.email,
          name: `${p.firstName} ${p.lastName}`,
          passwordHash,
          role: p.role,
          employmentType: "FULL_TIME",
          employmentStartDate: p.startDate,
          departmentId: departments.get(p.department)!,
          countryCode: "DE",
          timezone: "Europe/Berlin",
          title: p.title,
        },
      });
      userIds.set(p.email, user.id);
    }

    for (const p of drafts) {
      await tx.user.update({
        where: { id: userIds.get(p.email)! },
        data: p.managerEmail ? { managerId: userIds.get(p.managerEmail) } : {},
      });
    }

    // Demo delegation: Lukas is out 2026-08-01..15; Felix covers his approvals.
    await tx.approvalDelegation.create({
      data: {
        companyId: company.id,
        userId: userIds.get("lukas.fischer@acme.dev")!,
        delegateId: userIds.get("felix.wagner@acme.dev")!,
        startsOn: "2026-08-01",
        endsOn: "2026-08-15",
      },
    });

    // Track vacation usage per leave year (calendar year for fiscal month 1),
    // so the previous year's row and the carried-over component are real.
    const vacationUsedByYear = new Map<string, Map<string, number>>();
    const vacationPendingByYear = new Map<string, Map<string, number>>();
    const bumpDays = (
      map: Map<string, Map<string, number>>,
      year: string,
      userId: string,
      days: number,
    ) => {
      let inner = map.get(year);
      if (!inner) {
        inner = new Map();
        map.set(year, inner);
      }
      inner.set(userId, (inner.get(userId) ?? 0) + days);
    };

    for (const p of drafts) {
      for (const req of p.requests) {
        const { totalDays, days } = computeTotalDays(req);
        const approverId = req.approverEmail ? (userIds.get(req.approverEmail) ?? null) : null;
        const leaveTypeKey = req.type;
        const created = await tx.leaveRequest.create({
          data: {
            companyId: company.id,
            userId: userIds.get(p.email)!,
            leaveTypeId: leaveTypes.get(leaveTypeKey)!,
            startDate: req.startDate,
            endDate: req.endDate,
            startDayPart: req.startDayPart,
            endDayPart: req.endDayPart,
            totalDays,
            reason: req.reason,
            status: req.status,
            currentApprovalLevel: req.status === "PENDING" ? 0 : 1,
            approvedById: req.status === "APPROVED" ? approverId : null,
            approvedAt: req.status === "APPROVED" && req.approvedAt ? parseDayDate(req.approvedAt) : null,
            effectiveApproverId: req.status === "REJECTED" ? approverId : null,
            rejectionReason: req.rejectionReason,
            days: { create: days.map((d) => ({ date: d.date, dayPart: d.dayPart })) },
          },
        });

        if (req.status !== "PENDING") {
          await tx.approvalStep.create({
            data: {
              leaveRequestId: created.id,
              approverId: approverId ?? userIds.get(p.email)!,
              level: 1,
              action: req.status,
              comment: req.status === "REJECTED" ? req.rejectionReason ?? null : null,
            },
          });
        }

        if (leaveTypeKey === "VACATION") {
          const key = userIds.get(p.email)!;
          const year = req.startDate.slice(0, 4);
          if (req.status === "APPROVED") bumpDays(vacationUsedByYear, year, key, totalDays);
          if (req.status === "PENDING") bumpDays(vacationPendingByYear, year, key, totalDays);
        }

        if (req.status === "PENDING" && approverId) {
          await tx.notification.create({
            data: {
              userId: approverId,
              type: "request.submitted",
              title: `${p.firstName} ${p.lastName} requested leave`,
              body: `${req.startDate} – ${req.endDate} (${totalDays} day${totalDays === 1 ? "" : "s"})`,
              entityType: "LeaveRequest",
              entityId: created.id,
            },
          });
        }
        if (req.status === "APPROVED") {
          await tx.notification.create({
            data: {
              userId: userIds.get(p.email)!,
              type: "request.approved",
              title: "Leave approved",
              body: `${req.startDate} – ${req.endDate} approved.`,
              entityType: "LeaveRequest",
              entityId: created.id,
            },
          });
        }
      }
    }

    for (const p of drafts) {
      const userId = userIds.get(p.email)!;

      // Previous leave year (2025): only that year's accrual slice and the
      // vacation actually taken that year. Carried-over/adjustments are 0 by
      // design.
      const used25 =
        (vacationUsedByYear.get("2025")?.get(userId) ?? 0) +
        (vacationPendingByYear.get("2025")?.get(userId) ?? 0);
      const cumulativeThrough2025 = accruedVacationAsOf({
        annualAllotment: ANNUAL_ALLOTMENT,
        employmentStartDate: p.startDate,
        asOf: "2025-12-31",
      });
      const accrued25 = Math.max(
        0,
        Math.round(
          (cumulativeThrough2025 -
            accruedVacationAsOf({
              annualAllotment: ANNUAL_ALLOTMENT,
              employmentStartDate: p.startDate,
              asOf: "2024-12-31",
            })) *
            100,
        ) / 100,
      );
      // What actually rolls into 2026: the TOTAL eligible unused history
      // (everything ever earned minus everything ever taken) capped by the
      // policy — matching the runtime engine, which applies the cap to the
      // whole unused history rather than to a single year.
      const carriedOver26 = cappedCarryOver(
        CARRY_OVER_DAYS,
        Math.max(0, Math.round((cumulativeThrough2025 - used25) * 100) / 100),
      );
      await tx.leaveBalance.create({
        data: {
          companyId: company.id,
          userId,
          leaveTypeId: leaveTypes.get("VACATION")!,
          periodStart: "2025-01-01",
          periodEnd: "2025-12-31",
          accrued: accrued25,
          carriedOver: 0,
          adjustment: 0,
          used: used25,
          pending: 0,
        },
      });

      // Current leave year (2026): only this year's accrual slice so far.
      const accrued = Math.max(
        0,
        Math.round(
          (accruedVacationAsOf({
            annualAllotment: ANNUAL_ALLOTMENT,
            employmentStartDate: p.startDate,
            asOf: todayISO(),
          }) -
            cumulativeThrough2025) *
            100,
        ) / 100,
      );
      await tx.leaveBalance.create({
        data: {
          companyId: company.id,
          userId,
          leaveTypeId: leaveTypes.get("VACATION")!,
          periodStart: LEAVE_YEAR_START,
          periodEnd: LEAVE_YEAR_END,
          accrued,
          carriedOver: carriedOver26,
          adjustment: p.email === "julia.hoffmann@acme.dev" ? 2 : 0,
          used: vacationUsedByYear.get("2026")?.get(userId) ?? 0,
          pending: vacationPendingByYear.get("2026")?.get(userId) ?? 0,
        },
      });
    }
  });

  const totals = { users: drafts.length, requests: drafts.reduce((s, p) => s + p.requests.length, 0) };
  console.log(`Seeded ${COMPANY_NAME}: ${totals.users} users, ${totals.requests} leave requests.`);
  console.log(`Sign in with <name>@${COMPANY_DOMAIN} / "${DEV_PASSWORD}".`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
