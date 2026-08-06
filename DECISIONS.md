# DECISIONS — TimeOff

Every material assumption, business-rule choice, and deviation from the
original spec. This file is a living contract between product intent and code.
Anything that affects **pay, legal compliance, or approval rights** is flagged
explicitly here and must be reviewed before shipping.

Status legend: ✅ decided & implemented · 🚧 decided, not yet built · ⚠️ assumption, review

---

## Architecture

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| A1 | **Single-tenant, multi-tenant-ready.** One company per deployment; `Company` root entity; tenant scoping designed so a future SaaS can be layered on without a schema rewrite. Billing/seats stubbed. | ✅ | Confirmed with stakeholder. |
| A2 | **Next.js API routes + server actions** (not NestJS). One deployable; server actions for mutations, route handlers for programmatic endpoints (iCal, exports, webhooks). | ✅ | Confirmed with stakeholder. Single codebase, single deploy target. |
| A3 | **Monorepo, Turborepo + pnpm workspaces.** `apps/web`, `packages/{ui,db,domain,email,config}`. | ✅ | Design system and domain logic are independent deliverables; parallelizable builds. |
| A4 | **Domain logic lives in a pure, framework-free package** (`@timeoff/domain`) — balance, overlap, approval chains, business-day math. Unit-tested without HTTP. | ✅ | The "never silently invent rules" discipline is enforced here. |
| A5 | **Background jobs** via BullMQ/Redis in a separate worker entrypoint. Idempotent, retry-safe. | ✅ | Stage 6: `@timeoff/worker` with recurring schedulers (leave reminders, manager digest, audit/email purge, outbox sweep) + transactional email outbox drained by BullMQ. |
| A6 | **RBAC enforced server-side only.** Client never gates authorization, only presentation. Shared `requireRole()` guard wraps every mutation/endpoint. | ✅ | `apps/web/lib/session.ts` — `requireAuth()`/`requireRole()` wrap layouts, actions, and route handlers. |

## Leave-law model (v1)

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| L1 | **EU statutory only in v1.** Fixed annual allotments per leave type per period; no US-style accrual math. | ✅ | Confirmed with stakeholder. |
| L2 | Schema must still **model accrual-style policies without rewrite** (accrual rate, caps, carry-over, probation live on `LeavePolicy`). The engine can grow an accrual mode later. | ✅ | Anti-regret structural choice. |
| L3 | **Business-day counting excludes weekends + company/regional holidays** for the selected country/region. | ✅ | `@timeoff/domain` `business-days.ts` — `listBusinessDays`, `countBusinessDays`, `nextWorkingDay`; Vitest-covered. Half-day-aware span expansion in `leave-days.ts`. |
| L4 | **Carry-over is per-policy config with an explicit default of 10 days** (vacation). When a request is planned into a leave year with no balance row yet, the engine rolls over `min(policy.carryOverDays, max(0, prior-year available))` — no cascading. Carried days expire per the policy's `carryOverExpiresOn` MM-DD; a request that would consume carried days must end on or before that deadline. | ✅ | `carryOverDeadline()` in `@timeoff/domain`; engine in `resolveBalanceForDate`/create; admin validates MM-DD. Stage 5. |
| L5 | **Negative balance default = disabled**; `maxNegative` exists per policy for HR opt-in. | ✅ | `LeavePolicy.negativeAllowed`/`maxNegative`; enforced in the Stage 3 request engine — over-balance requests are rejected unless the policy allows a bounded negative. |
| L6 | **Probation**: per-policy rule (e.g. "no paid leave in first N days"). | ✅ | `LeavePolicy.probationDays`; enforced in the request engine for paid leave (`startDate < hire + probationDays` → rejected). Default `0` = off; seed gives Vacation a 30-day window (no seeded user is inside it). |

## Permissions & approvals

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| P1 | Roles: `EMPLOYEE`, `MANAGER`, `HR`, `SUPER_ADMIN`, `EXECUTIVE` (read-only). JWT carries role + companyId; `requireRole()` server guard. | ✅ | `Role` enum; `auth.ts` callbacks hydrate the JWT; `lib/session.ts` guards. Stage 5 adds the read-only `EXECUTIVE` role + `/workforce` snapshot page. |
| P2 | **Approval chain**: direct manager by default; multi-level chain + HR override configurable via `ApprovalRule`; delegation (manager out of office) supported. | ✅ | Stage 4: multi-level chain (snapshot rule at submit, advance `currentApprovalLevel` per decision), delegation resolved at decision time, HR/SUPER_ADMIN override only when not the expected chain approver. |
| P3 | **Who approves a request that crosses the manager's own leave?** Delegation must resolve the effective approver *at approval time*, not at submission time. | ✅ | `decideLeaveRequest` re-resolves the rule chain at decision time and records `effectiveApproverId` = the actual decider; active `ApprovalDelegation` (owner, date-bounded) routes the current step to the delegate; HR/SUPER_ADMIN can decide any request. |

## Integrations & auth

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| I1 | **Auth**: email/password + Google OAuth via Auth.js (NextAuth v5); JWT sessions with RBAC claims; Google login gated to existing ACTIVE users (no auto-provision in v1). **No SAML/Entra in v1.** | ✅ | Implemented: Credentials provider (bcrypt), conditional Google provider, JWT role/companyId claims, `/login`, protected `(app)` layout. Verified end-to-end. |
| I2 | **iCal export only in v1** (per-user private feed). No two-way Google/Outlook, no Slack/Teams. | ✅ | Per-user feed token (AES-GCM in `Integration`, kind ICAL); `GET /api/ical/[userId]?token=…` serves all-day VEVENTs of the user's approved leave; subscribe + rotate UI on `/calendar`. Stage 5. |
| I3 | Email: transactional via Resend. In-app notification center first-class. | ✅ | Stage 6: transactional outbox (`EmailMessage` committed with the mutation) + Resend delivery with dev-mode fallback; in-app notification center (bell + `/notifications`, mark read / mark all). |
| I4 | Attachments (e.g. medical certificates): S3-compatible bucket, encrypted at rest, signed access. | ✅ | MinIO dev bucket; blobs AES-256-GCM encrypted **before** upload (bucket never sees plaintext); download via session or short-lived HMAC link; soft delete + purge; owner/manager/HR access; `requiresAttachment` enforced per leave type/policy. Stage 5. |

## Design system

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| D1 | **Identity: "sea & sand".** Lagoon teal primary + warm sand neutral + Fraunces display serif over Inter body. Deliberately not the default indigo SaaS look. | ✅ | Approved in proposal. |
| D2 | **Leave-type palette is never the sole signal** — every status/type carries icon or text alongside color (WCAG AA). | ✅ | Accessibility. |
| D3 | Motion (Framer Motion, 150–250ms, `cubic-bezier(0.4,0,0.2,1)`) only for meaningful moments; `prefers-reduced-motion` respected globally. | ✅ | Restraint by design. |
| D4 | Light/dark from day one, same token set, `color-scheme` set per theme (native form controls follow). | ✅ | |

## GDPR / compliance-mindedness

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| G1 | `AuditLog` on every sensitive mutation (before/after JSON diff). Exportable. | ✅ | Stage 4: HR console actions (user create/update, department create/rename, leave type create, policy update, balance adjust, delegation create/deactivate) all write `AuditLog` rows in addition to the leave-request mutations. |
| G2 | User data export & delete requests must be buildable: no hard-coded US-only assumptions, countries/regions are first-class on policies & holidays. | ✅ (design posture) | |
| G3 | **Retention policy for audit logs & HR adjustments**: decided — **3 years** for `AuditLog` (configurable `AUDIT_RETENTION_DAYS`), 90 days for sent-email archive; purged nightly by the `audit-purge` job. | ✅ | Stage 6: `@timeoff/worker` `runAuditPurge()` deletes `AuditLog` older than the cap and `EmailMessage` rows older than the email cap. |

## Open questions to resolve before the relevant stage

- Google auto-provisioning on first login (currently: existing users only) — before Stage 4.
- Product name: candidates **Outboard / Lagoon / Breather** (working name "TimeOff").

## Stage 2 notes (infrastructure realities)

- **Port 5432 clash**: a locally installed native PostgreSQL was already bound to
  `0.0.0.0:5432`, shadowing the Docker database. Docker Postgres runs on
  **`5433`**; `DATABASE_URL` reflects that. If you run no native Postgres, you may
  map back to `5432`.
- **pnpm 11 build-allowlist** lives in `pnpm-workspace.yaml` (`allowBuilds`);
  `onlyBuiltDependencies` in `package.json` is deprecated and ignored.
- Prisma CLI warns `package.json#prisma` is deprecated in favor of
  `prisma.config.ts` — non-blocking; migrate when convenient.
- Seed data is deterministic (seeded PRNG); every user signs in with
  `password123`. All balances are non-negative and no two requests of one user
  overlap (half-day aware), so the dataset is a safe demo of the Stage 3 engine.
- Docs/seed: `prisma migrate dev --name <name>` is used non-interactively during
  dev; production applies via `prisma migrate deploy`.

## Stage 3 notes (request engine, approvals, team calendar)

All request logic lives in `apps/web/lib/services/leave.ts` (thin server actions
in `apps/web/lib/actions/leave.ts` wrap it; auth is enforced server-side only).

- **Validation order** on create: span validity & contains working days
  (weekends/holidays excluded) → half-day-aware overlap vs. the user's own
  non-final (`PENDING`/`APPROVED`) requests → balance sufficiency → probation →
  approver resolution. Auto-approves leave types flagged
  `requiresApproval: false` (sick leave).
- **Balance accounting**: `available = accrued + carriedOver + adjustment − used − pending`.
  Creating a `PENDING` request adds `totalDays` to `pending`; approving moves it
  `pending → used`; rejecting/cancelling a pending request releases `pending`;
  cancelling an approved request releases `used`. Spans charging across a leave
  year charge the whole request to the year containing its start date.
- **Lazy leave-year balance**: if no balance row covers the request's start
  date (e.g. booking into next year), the engine plans one from the policy's
  `annualAllotment` (prorated for hire date + part-time ratio) and persists it
  only if the request succeeds — so "book 120 days of next year" is rejected
  against a 30-day entitlement, not silently allowed.
- **Approver resolution**: first matching active `ApprovalRule` (scoped by
  department/leave type, ordered by level); kinds: direct manager, manager's
  manager, any HR/SUPER_ADMIN, or a specific user. Fallback: none → request
  stays `PENDING` for HR oversight.
- **Notifications + audit** are written for every mutation: approver is notified
  on submit; requester on approve/reject; `AuditLog` before/after rows on all
  four actions.
- **Approvals scope**: managers see requests where the resolved approver is
  them; HR/SUPER_ADMIN see every pending request company-wide. The dashboard's
  "Approvals waiting on you" card uses the direct-reports subset.
- **Team calendar** (`/calendar`) renders approved + pending spans (half-day
  aware, weekend/holiday-free) with per-type color dots and a per-day "who's
  off" list; month navigation + department filter via query params.
- Verified: 20-check service smoke (create/overlap/balance/cancel/approve/
  reject + authorization + notifications + audit) against the seeded DB, plus
  prod-build HTTP smoke (unauth redirects, credentials login, all four pages).

## Stage 4 notes (multi-level approval, delegation, HR console)

Schema: `ApprovalStep` (one decided step per level, records approver/level/action/
comment), `ApprovalDelegation` (owner → delegate, optional date bounds, `active`),
and `LeaveRequest.currentApprovalLevel` (level of the last completed step).

- **Chain walk** (`resolveApprover`): the lowest matching active `ApprovalRule`
  strictly above `currentApprovalLevel` resolves the *next* approver. Rules are
  scoped by department/leave type; kinds are direct manager, manager's manager,
  HR (prefers a dedicated `HR` over `SUPER_ADMIN`), or a specific user.
- **Delegation is resolved at decision time**: `activeDelegateFor` picks the
  newest active `ApprovalDelegation` covering the request's start date and the
  delegate becomes the effective approver for that step. The owner is blocked
  while a delegation is active.
- **Advancing**: an approval writes an `ApprovalStep` at the resolved level and
  either advances `currentApprovalLevel` and notifies the next approver, or —
  when the chain is exhausted — finalizes to `APPROVED` and moves
  `pending → used`. Rejection is final at any level (frees `pending`).
- **HR/SUPER_ADMIN override only when not the expected approver**: when an
  HR/SUPER_ADMIN is the chain's resolved approver (e.g. the HR review step) the
  request advances normally; overriding a request outside their chain role
  finalizes immediately.
- **HR console** (`/admin/*`, gated to HR/SUPER_ADMIN and hidden from the nav
  for everyone else): overview stats, people directory (create/edit users,
  vacation balance shown), departments (create/rename), leave types + policies
  (create type with policy, edit allotment/carry-over/negative/probation/
  approval override), and balances (per-user/year adjust with reason —
  rejected if it would go negative; notifies the employee). Every mutation is
  audited.
- **Delegation UI** on `/approvals`: managers (and HR) create date-bounded
  delegations from a team-member picker and deactivate them; rows show what's
  covered and whether it's active/scheduled/inactive. A seeded demo delegation
  has Lukas Fischer covered by Felix Wagner on 2026-08-01..15.
- **Seed**: multi-level rules (manager → skip-level for Engineering → HR) and a
  demo delegation; seeded `PENDING` requests start at level 0, final requests
  carry a level-1 `ApprovalStep`.
- Verified: 16-check service smoke (chain advance levels 1→2→3, step records,
  delegation routing + owner blocked, HR override, short-circuit reject,
  self-delegation validation, balance invariant) plus prod-build HTTP smoke
  (HR pages render, role gate redirects managers/employees to `/dashboard`,
  employee nav hides Admin, delegation panel renders for its owner).

## Stage 5 notes (carry-over, attachments, iCal, executive view)

- **Carry-over (L4)**: `carryOverDeadline(year, mmdd)` in `@timeoff/domain`
  (RangeError on malformed input; Vitest-covered). When the engine plans a
  leave year that has no balance row, it rolls over
  `min(policy.carryOverDays, max(0, prior-year available))` — capped, never
  cascading, `carriedOver` persisted on the planned row. On create, if a request
  would consume carried days (span days > accrued + adjustment) and the policy
  sets `carryOverExpiresOn`, the request's `endDate` must be ≤ the deadline —
  otherwise `LeaveError`. Admin validates `carryOverExpiresOn` is a valid MM-DD.
  Seed Vacation policy expiry moved **03-31 → 12-31** (a mid-year seed would
  otherwise make 2026 carried days already unusable).
- **Attachments (I4)**: new `Attachment` model (staged rows have `requestId=null`).
  Blobs are AES-256-GCM encrypted in `lib/crypto.ts` (iv|tag|ct layout) **before**
  the `putObject` to S3/MinIO, so the bucket stores only ciphertext (verified in
  smoke). Upload → `POST /api/attachments` (multipart `file` + `kind`) →
  `stageAttachment`; the create-request transaction binds staged rows via
  `attachStagedAttachments`. `requiresAttachment` (leave-type or policy override)
  blocks submission until an attachment is staged. Download → `GET
  /api/attachments/[id]` via session (owner, their manager, HR/SUPER_ADMIN) or a
  short-lived HMAC link (`?expires&sig`). Delete = soft delete + bucket purge +
  audit. 10 MB max; pdf/png/jpg/webp only. `S3_*` + `ENCRYPTION_KEY` +
  `SIGNING_SECRET` in `apps/web/.env.local`; MinIO in docker-compose (ports
  9000/9001). `ensureBucket()` creates the bucket on first use.
- **iCal (I2)**: per-user feed token stored AES-GCM-encrypted in `Integration`
  (kind `ICAL`, unique per company+user). `GET /api/ical/[userId]?token=…` serves
  the user's approved leave as all-day VEVENTs (DTEND exclusive, `TRANSP:
  TRANSPARENT`, half-day suffix in summary), constant-time token comparison,
  `no-store`. `/calendar` shows the subscribe URL with copy + rotate.
- **EXECUTIVE (P1)**: role added to seed (`robert.schmidt@acme.dev`,
  `password123`); nav `minRole: "executive"` (rank 1 → EXECUTIVE and above) in
  the "Insights" section; `/workforce` is a read-only company snapshot (headcount,
  off today, pending, approved days this year, headcount by department, leave by
  type, upcoming approved leave) gated `requireRole(["EXECUTIVE","MANAGER","HR"])`
  to match nav visibility.
- **Admin leave types**: `requiresAttachment` on leave types and on policy
  overrides; badges shown on `/admin/leave-types`.
- Verified: domain 34 tests green; web typecheck/lint/build clean; migration
  applied; seed → 41 users/219 requests (incl. EXECUTIVE). Engine smoke (13
  checks): carry-over rolls 10 days capped into the new leave year, requests
  past the 12-31 deadline are rejected, carried days usable up to the deadline;
  staging rejects bad content types and >10 MB, `requiresAttachment` blocks
  unprovisioned submissions, staged rows bind atomically on create, download
  round-trips decrypted plaintext, non-owner/manager/HR is blocked, HMAC
  signed-link verify + expiry, attach-to-existing + double-attach rejected,
  cross-user attach rejected, list access respected, soft delete blocks further
  downloads. HTTP smoke: EXECUTIVE login → `/workforce` renders (Admin nav
  hidden), `/admin` redirects to `/dashboard`, iCal route 403s without a valid
  token and serves a valid VCALENDAR with one, attachment upload 200 → download
  200 (decrypted round-trip) → anon 403, MinIO object confirmed ciphertext at
  rest.

## Stage 6 notes (background jobs, transactional email, retention)

- **Transactional outbox (I3)**: every email-worthy mutation now writes an
  `EmailMessage` row *inside the same `prisma.$transaction`* as the mutation
  (`enqueueOutbox(tx, …)` in `apps/web/lib/emails.ts`), then best-effort adds an
  `email.send` BullMQ job after commit (`enqueueEmails` — never throws). The
  recurring `outbox.sweep` re-enqueues QUEUED/FAILED rows and resets rows stuck
  in SENDING, closing the crash gap between DB commit and Redis add. Deliveries
  are idempotent: claiming is `QUEUED → SENDING` via a conditional
  `updateMany`, so a message is never sent twice.
- **Email templates**: `packages/email` renders 8 typed templates
  (`request.submitted/approved/rejected`, `approval.step`, `balance.adjust`,
  `leave.starts`, `leave.starts.team`, `digest.pending`) with inline-styled HTML
  and a text fallback. **Dev mode**: without `RESEND_API_KEY` the sender returns
  `{ delivered: false, reason: "RESEND_API_KEY not set (dev mode)" }`, and the
  processor marks the row `SENT` with that reason so the whole pipeline stays
  verifiable without a provider. Failures retry up to `MAX_EMAIL_ATTEMPTS` (5);
  render/send exceptions are caught and counted rather than leaving a row stuck
  in SENDING.
- **Schedulers (A5)** on the `scheduled` queue: `leave-reminders` (daily 06:00 —
  approved leave starting tomorrow → employee + their active manager;
  dedupe `leave.starts:<scope>:<requestId>:<date>`), `manager-digest` (Mon 08:00
  — pending requests from direct reports per manager, plus HR/SUPER_ADMIN
  company-wide; dedupe `digest.pending:<companyId>:<scope>:<monday>`; a manager
  with no email address gets a `mailto:` link instead), `audit-purge` (03:00 —
  G3), `outbox-sweep` (every 300s). `run-once.ts` exposes each handler for
  manual runs and smoke tests.
- **Notification center (I3)**: `NotificationBell` in the app shell (unread
  badge + recent 8 + one-click actions), full `/notifications` page (all rows,
  mark read / mark all, links into requests), `markNotificationReadAction` /
  `markAllNotificationsReadAction` in `lib/actions/notifications.ts`.
- **Retention (G3)**: `AUDIT_RETENTION_DAYS` default 3 years
  (`3*365`) → `audit.purge` deletes `AuditLog` older than the cap; sent-email
  archive kept 90 days (`EMAIL_MESSAGE_RETENTION_DAYS`). Both configurable via
  the worker env (loaded from `apps/web/.env.local`).
- **Infra notes**: BullMQ 6.0.8 (added to `minimumReleaseAgeExclude`), resend
  6.18.1, ioredis 6, dotenv 17 (pnpm 11 `allowBuilds` now includes
  `msgpackr-extract`). The web build marks `bullmq`/`ioredis` as
  `serverExternalPackages` and `@timeoff/email` transpiled — Next's bundler can't
  resolve BullMQ's optional `@valkey/valkey-glide` client.
- Verified: domain 34/34 green; web + worker + email typecheck/lint/build clean;
  seed → 41 users/219 requests/169 notifications/0 audits/0 emails. Worker smoke:
  digest queues 9 deduped messages (re-run queues 0), `send` marks SENT
  (dev mode) with `sentAt`, a corrupt template reaches FAILED after max
  attempts, sweep re-enqueues stale QUEUED rows, live worker drains all jobs.
  Web smoke: creating a leave request commits an outbox row and the live worker
  marks it SENT; HTTP login → `/notifications` renders with unread count and
  mark-all.

## Stage 7 notes (calendar explorer, Excel export)

- **One visibility authority**: every calendar/export query goes through
  `getVisibleUserIds` (`lib/permissions.ts`) — company-wide roles (`HR`,
  `SUPER_ADMIN`, `EXECUTIVE`) see the whole company; `MANAGER`/`EMPLOYEE` are
  scoped to their own department. Department/leave-type/status filters are
  applied **only inside** that scope; a `departmentId` filter is silently
  ignored for non-company-wide roles (the scope always wins — verified in
  smoke).
- **Calendar feed** (`lib/services/calendar.ts`): `listCalendarRequests`
  (date-bounded, half-day aware) and `listCalendarRoster` (active users in
  scope) power the client explorer via `GET /api/calendar?from&to&statuses&
  leaveType&department&roster`. Default statuses `APPROVED,PENDING`; holidays
  come from the existing `companyHolidays` helper.
- **Export access (new permission)**: `canExport(user)` = `MANAGER` +
  company-wide roles; `EMPLOYEE` is denied. There is no new role — this mirrors
  who can already see `/calendar` data. `listExportRows` exposes the full
  request history (any status, dates optional) so "export everything" and
  "export current filters" reuse the same scoped query.
- **Excel builder** (`lib/excel.ts`, **exceljs** — server-only, added to
  `apps/web` deps): 14 columns (employee, department, leave type, start/end
  date, start/end day half, working days, status, reason, approver,
  approval/rejection date, rejection reason, submitted). All strings are passed
  in (localized); real Excel date/datetime cells (UTC to avoid TZ shifts),
  rows 1-2 merged title + scope line, header row 3 frozen with `autoFilter
  A3:N3`, landscape `fitToWidth 1`.
- **`POST /api/export`** writes an audit row (`action: "export.requests"`,
  `entityType: "LeaveRequest"`, `entityId: "export"`, `after` = format/scope/
  range/statuses/rowCount/filename) so every download is traceable (G1).
  Filename: `timeoff-export-<date>[-<slugified department>].xlsx`.
- **Calendar explorer** (`/calendar`, client component): month / list / team
  views, month & quarter presets + custom `DateRangePicker`, include-pending
  toggle, leave-type + department filters (native selects; department filter
  only for company-wide roles), refresh, and an `ExportButton` (filters vs
  everything). The `/workforce` header reuses `ExportButton` with "everything".
  Month view draws full-duration bars (half-day edges, pending faded, tooltip +
  link to the request); team view is a quarter-capable Gantt; list view groups
  by date or employee.
- Verified: domain 34/34; web typecheck/lint/build clean; **access-smoke now 42
  checks** incl. calendar/roster scoping, `canExport` matrix, manager exports
  being department-only even with a foreign-department filter, company-wide
  exports covering both departments, and a real xlsx (zip magic) produced by
  the builder.
