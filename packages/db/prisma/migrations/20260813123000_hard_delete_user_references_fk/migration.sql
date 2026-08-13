-- AlterTable: relax FK referential actions for hard-delete reference cleanup.
-- When a User is permanently deleted, their references on other users' records
-- (approver / delegation delegate) are nulled automatically as a safety net
-- in addition to the explicit null-out in deleteUserForAdmin.

-- DropForeignKey
ALTER TABLE "ApprovalDelegation" DROP CONSTRAINT "ApprovalDelegation_delegateId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalStep" DROP CONSTRAINT "ApprovalStep_approverId_fkey";

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
