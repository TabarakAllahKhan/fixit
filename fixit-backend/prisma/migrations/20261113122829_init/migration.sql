-- CreateEnum
CREATE TYPE "ApplianceCategory" AS ENUM ('WASHING_MACHINE', 'REFRIGERATOR');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('MANUAL', 'MANUFACTURER_PAGE', 'OTHER', 'TEST_FIXTURE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('UNREVIEWED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SafetyClass" AS ENUM ('USER_SAFE', 'TECHNICIAN_ONLY');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MODERATE', 'HARD');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('FIXED', 'NEEDS_PART', 'CALL_TECHNICIAN');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appliance" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "ApplianceCategory" NOT NULL,
    "brand" TEXT NOT NULL,
    "modelNumber" TEXT,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "url" TEXT,
    "edition" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorCode" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "category" "ApplianceCategory" NOT NULL,
    "brand" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "modelScope" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairStep" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "instruction" TEXT NOT NULL,
    "safetyClass" "SafetyClass" NOT NULL,
    "difficulty" "Difficulty",
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorCodeRepairStep" (
    "errorCodeId" UUID NOT NULL,
    "repairStepId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',

    CONSTRAINT "ErrorCodeRepairStep_pkey" PRIMARY KEY ("errorCodeId","repairStepId")
);

-- CreateTable
CREATE TABLE "DiagnosisSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "applianceId" UUID,
    "errorCodeId" UUID,
    "symptom" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "verdict" "Verdict",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosisSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorCode_sourceId_idx" ON "ErrorCode"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorCode_category_brand_code_modelScope_key" ON "ErrorCode"("category", "brand", "code", "modelScope");

-- CreateIndex
CREATE INDEX "RepairStep_sourceId_idx" ON "RepairStep"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorCodeRepairStep_errorCodeId_position_key" ON "ErrorCodeRepairStep"("errorCodeId", "position");

-- CreateIndex
CREATE INDEX "DiagnosisSession_userId_idx" ON "DiagnosisSession"("userId");

-- CreateIndex
CREATE INDEX "DiagnosisSession_applianceId_idx" ON "DiagnosisSession"("applianceId");

-- CreateIndex
CREATE INDEX "DiagnosisSession_errorCodeId_idx" ON "DiagnosisSession"("errorCodeId");

-- CreateIndex
CREATE INDEX "Message_sessionId_idx" ON "Message"("sessionId");

-- AddForeignKey
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCode" ADD CONSTRAINT "ErrorCode_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairStep" ADD CONSTRAINT "RepairStep_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeRepairStep" ADD CONSTRAINT "ErrorCodeRepairStep_errorCodeId_fkey" FOREIGN KEY ("errorCodeId") REFERENCES "ErrorCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorCodeRepairStep" ADD CONSTRAINT "ErrorCodeRepairStep_repairStepId_fkey" FOREIGN KEY ("repairStepId") REFERENCES "RepairStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosisSession" ADD CONSTRAINT "DiagnosisSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosisSession" ADD CONSTRAINT "DiagnosisSession_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosisSession" ADD CONSTRAINT "DiagnosisSession_errorCodeId_fkey" FOREIGN KEY ("errorCodeId") REFERENCES "ErrorCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DiagnosisSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
