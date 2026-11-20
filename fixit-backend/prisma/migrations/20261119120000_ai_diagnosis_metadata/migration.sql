-- AlterTable
ALTER TABLE "DiagnosisSession" ADD COLUMN     "context" JSONB;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientRequestId" UUID,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
-- A single AI turn persists one USER and one ASSISTANT message. The role in the
-- key permits both rows while preventing duplicate rows for the same request.
CREATE UNIQUE INDEX "Message_sessionId_clientRequestId_role_key" ON "Message"("sessionId", "clientRequestId", "role");
