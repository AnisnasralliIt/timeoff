-- AlterTable: allow archiving leave types instead of deleting them.
ALTER TABLE "LeaveType" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;
