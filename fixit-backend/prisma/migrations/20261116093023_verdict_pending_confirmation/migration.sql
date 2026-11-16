-- AlterEnum
-- Rename the existing value in place so any existing CALL_TECHNICIAN verdicts are
-- preserved as TECHNICIAN_REQUIRED. Recreating the enum type would fail on those
-- rows (or require a lossy default), so the rename is the safe mapping.
BEGIN;
ALTER TYPE "Verdict" RENAME VALUE 'CALL_TECHNICIAN' TO 'TECHNICIAN_REQUIRED';
ALTER TYPE "Verdict" ADD VALUE 'UNRESOLVED';
COMMIT;

-- AlterTable
ALTER TABLE "DiagnosisSession" ADD COLUMN     "fixConfirmationChallengeId" TEXT,
ADD COLUMN     "fixConfirmationIssuedAt" TIMESTAMP(3),
ADD COLUMN     "fixConfirmationExpiresAt" TIMESTAMP(3);
