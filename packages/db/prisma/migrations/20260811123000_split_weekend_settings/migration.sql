-- AlterTable: split the single weekend setting into two independent toggles.
ALTER TABLE "Company" ADD COLUMN     "countWeekendsWithinSpan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extendWeekendAfterFriday" BOOLEAN NOT NULL DEFAULT false;

-- Migrate the old single setting to its closest equivalent (interior-weekend
-- counting). extendWeekendAfterFriday is a genuinely new rule, so every
-- existing company keeps it off.
UPDATE "Company" SET "countWeekendsWithinSpan" = "countWeekendsInLeaveDuration";

-- DropColumn
ALTER TABLE "Company" DROP COLUMN "countWeekendsInLeaveDuration";
