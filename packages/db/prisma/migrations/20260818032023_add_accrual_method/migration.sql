-- CreateEnum
CREATE TYPE "AccrualMethod" AS ENUM ('CUMULATIVE_MONTHLY', 'FIXED_ANNUAL');

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "accrualMethod" "AccrualMethod" NOT NULL DEFAULT 'CUMULATIVE_MONTHLY';
