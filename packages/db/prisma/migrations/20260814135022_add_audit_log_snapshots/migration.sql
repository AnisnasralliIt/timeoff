-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorNameSnapshot" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "entityNameSnapshot" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_employeeId_createdAt_idx" ON "AuditLog"("companyId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- ---------------------------------------------------------------------------
-- Backfill snapshot columns from the live rows so existing history is readable.
-- Read-only: only new nullable columns are written, existing audit data is
-- never modified.
-- ---------------------------------------------------------------------------

-- actor display names (survives a later actor deletion)
UPDATE "AuditLog" AS al
SET "actorNameSnapshot" = u."name"
FROM "User" AS u
WHERE al."actorId" = u."id" AND al."actorNameSnapshot" IS NULL;

-- User-target events: entity name + the affected employee
UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = u."name", "employeeId" = al."entityId"
FROM "User" AS u
WHERE al."entityType" = 'User' AND al."entityId" = u."id" AND al."entityNameSnapshot" IS NULL;

-- LeaveRequest-target events: affected employee + requester display name
UPDATE "AuditLog" AS al
SET "employeeId" = lr."userId"
FROM "LeaveRequest" AS lr
WHERE al."entityType" = 'LeaveRequest' AND al."entityId" = lr."id" AND al."employeeId" IS NULL;

-- LeaveBalance-target events: affected employee
UPDATE "AuditLog" AS al
SET "employeeId" = lb."userId"
FROM "LeaveBalance" AS lb
WHERE al."entityType" = 'LeaveBalance' AND al."entityId" = lb."id" AND al."employeeId" IS NULL;

-- Named configuration entities (survives a later rename/delete)
UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = d."name"
FROM "Department" AS d
WHERE al."entityType" = 'Department' AND al."entityId" = d."id" AND al."entityNameSnapshot" IS NULL;

UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = lt."name"
FROM "LeaveType" AS lt
WHERE al."entityType" = 'LeaveType' AND al."entityId" = lt."id" AND al."entityNameSnapshot" IS NULL;

UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = lp."name"
FROM "LeavePolicy" AS lp
WHERE al."entityType" = 'LeavePolicy' AND al."entityId" = lp."id" AND al."entityNameSnapshot" IS NULL;

UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = c."name"
FROM "Company" AS c
WHERE al."entityType" = 'Company' AND al."entityId" = c."id" AND al."entityNameSnapshot" IS NULL;

UPDATE "AuditLog" AS al
SET "entityNameSnapshot" = u."name"
FROM "ApprovalDelegation" AS ad, "User" AS u
WHERE al."entityType" = 'ApprovalDelegation' AND al."entityId" = ad."id" AND ad."userId" = u."id" AND al."entityNameSnapshot" IS NULL;
