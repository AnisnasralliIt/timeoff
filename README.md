# TimeOff

A company-wide vacation & leave management platform — employees request
time off, managers approve it, HR configures policy, and executives see
workforce availability at a glance. Replaces spreadsheets and email chains.

> Working name. Alternatives under consideration: **Outboard / Lagoon / Breather**.

## Status

**Stage 6 complete**: background jobs, transactional email, an in-app
notification center, and audit retention.

- **Background jobs (A5)** — a standalone BullMQ worker (`@timeoff/worker`) runs
  on Redis: daily leave-start reminders, a Monday manager digest of pending
  requests, a nightly retention purge, and an outbox sweep that guarantees no
  email is ever lost between a DB commit and Redis. `pnpm dev:worker` runs it;
  `pnpm worker:once <handler>` runs any job ad hoc.
- **Transactional email (I3)** — every mutation (request submitted/approved/
  rejected, next approval step, balance adjustment) writes an `EmailMessage`
  row in the same DB transaction and hands it to the worker, which renders a
  typed template and delivers it via Resend. With no `RESEND_API_KEY` the app
  runs in a documented dev mode that still marks rows sent, so the pipeline is
  fully testable offline. A first-class notification center (bell in the shell
  + `/notifications`) shows the same events in-app with mark-read / mark-all.
- **Retention (G3)** — audit logs are kept **3 years** (configurable) and
  pruned nightly; the sent-email archive is kept 90 days.

Stage 5 shipped carry-over (L4), encrypted attachments (I4), the iCal feed
(I2), and the read-only EXECUTIVE `/workforce` view (P1).

Stage 4 shipped the manager & HR flows: multi-level approval chains (direct
manager → skip-level → HR review) with **delegation** resolved at decision
time, and the **HR console** (`/admin`) for people, departments, leave types &
policies, and balance adjustments — all audit-logged.

Stage 3 shipped the core employee flow: half-day-aware requests with live
working-day preview, strict balance enforcement, cancel + full history,
manager approve/reject inbox, and a half-day-aware `/calendar`.

Earlier stages: database schema + migrations + seed data (41-person company
with a year of leave history), pure domain logic (business days, half-day
spans, overlap, balance engine — 34 unit tests), and authentication
(Auth.js v5: credentials + optional Google OAuth, JWT RBAC claims, protected
app shell, live dashboard).

See `DECISIONS.md` for every architecture and business-rule decision.

## Stack

- **Frontend** — Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + Framer Motion
- **Design system** — `packages/ui` (token-driven, shadcn/Radix primitives, fully re-themed)
- **Backend** — Next.js API routes + server actions (single deployable)
- **Database** — PostgreSQL (Docker) + Prisma; Redis (Docker) powers BullMQ jobs
- **Object storage** — S3-compatible MinIO (Docker), AES-256-GCM encryption at rest
- **Domain logic** — `packages/domain` (pure, unit-tested: balance, overlap, approval chains)
- **Auth** — Auth.js v5, JWT strategy; RBAC role claims from the `User` table
- **Jobs** — BullMQ/Redis worker (`@timeoff/worker`)
- **Email** — transactional outbox + Resend (`@timeoff/email`) with dev-mode fallback

## Prerequisites

- Node.js ≥ 20 (tested on 24)
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker (Postgres on **`5433`**, Redis on `6379`, MinIO on `9000`/`9001`)

## Setup

```bash
pnpm install

# Provision infra + database
docker compose up -d
pnpm db:migrate        # prisma migrate dev (creates/applies migrations)
pnpm db:seed           # 41-person demo company, login: <name>@acme.dev / password123

# Web app secrets
cp apps/web/.env.example apps/web/.env.local   # set AUTH_SECRET; optional Google OAuth
```

Demo sign-in: `admin@acme.dev` (super admin), `robert.schmidt@acme.dev`
(executive), `lukas.fischer@acme.dev` (manager), `julia.hoffmann@acme.dev`
(HR), or any seeded `@acme.dev` user — password `password123`.

## Development

```bash
pnpm dev                # runs the Next.js app (Turborepo)
pnpm dev:worker         # runs the background worker (emails, reminders, digest, purge)
# open http://localhost:3000 — you'll be redirected to /login
```

Run any worker job ad hoc (smoke tests, manual sends):

```bash
pnpm worker:once leave.reminders
pnpm worker:once digest.pending
pnpm worker:once audit.purge
pnpm worker:once outbox.sweep
pnpm worker:once send <messageId>
```

Without `RESEND_API_KEY` in `apps/web/.env.local` the worker runs in dev mode:
outbox rows are marked sent with a note, so the email pipeline stays testable
offline.

The style guide (design-system review page) lives at `/style-guide` (sign in
first). `pnpm db:studio` opens Prisma Studio.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test               # @timeoff/domain unit tests (Vitest)
pnpm build
```

## Monorepo layout

```
apps/web            Next.js app (UI + API routes + server actions + auth)
apps/worker         BullMQ background worker (emails, reminders, digest, purge)
packages/ui         Design system: tokens.css, theme bridge, component library
packages/db         Prisma schema, migrations, client, seed data
packages/domain     Pure business logic + Vitest
packages/email      Transactional email templates + Resend sender
packages/config     Shared tsconfig / eslint presets
```
