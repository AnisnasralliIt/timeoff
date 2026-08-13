-- Make the approver/delegate references on *other users'* records nullable so a
-- permanently deleted user can be reference-cleaned instead of blocking the
-- deletion (ON DELETE RESTRICT previously made the cascade fail).
-- AlterTable
ALTER TABLE "ApprovalStep" ALTER COLUMN "approverId" DROP NOT NULL;
ALTER TABLE "ApprovalDelegation" ALTER COLUMN "delegateId" DROP NOT NULL;
