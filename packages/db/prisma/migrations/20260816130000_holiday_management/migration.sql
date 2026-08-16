-- Holiday management: extend the existing Holiday model (still the single
-- source of truth) with informational source/provider metadata, and enforce
-- one active holiday per company/date so Nager re-imports are idempotent.
--
-- The unique constraint is safe for existing data (seed holidays have one
-- entry per date per company). If any pre-existing duplicates existed they
-- would fail here loudly rather than being silently dropped.

CREATE TYPE "HolidaySource" AS ENUM ('MANUAL', 'NAGER_DATE');

ALTER TABLE "Holiday" ADD COLUMN     "source" "HolidaySource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Holiday" ADD COLUMN     "holidayTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Holiday" ADD COLUMN     "global" BOOLEAN NOT NULL DEFAULT false;

-- One active holiday per company/date (unique key used for idempotent imports
-- and duplicate prevention on manual create/edit).
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");
