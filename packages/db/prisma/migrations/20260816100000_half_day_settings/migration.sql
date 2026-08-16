-- Add the three independent half-day leave settings to Company.
-- halfDayEnabled toggles half-day leave company-wide; the other two gate
-- half days on the request's start and end dates respectively.
ALTER TABLE "Company" ADD COLUMN     "halfDayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "halfDayStartDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "halfDayEndDay" BOOLEAN NOT NULL DEFAULT false;
