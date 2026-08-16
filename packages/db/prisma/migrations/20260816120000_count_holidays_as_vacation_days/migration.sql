-- Add the company-wide "count holidays as vacation days" setting.
-- When OFF (default), a holiday inside a vacation period is not deducted from
-- the vacation balance (existing behavior). When ON, holidays inside a
-- vacation period are counted as vacation days. Weekends are never affected.
ALTER TABLE "Company" ADD COLUMN     "countHolidaysAsVacationDays" BOOLEAN NOT NULL DEFAULT false;
