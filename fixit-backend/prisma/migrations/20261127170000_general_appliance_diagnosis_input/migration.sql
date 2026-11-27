-- AlterTable
ALTER TABLE "Appliance" ALTER COLUMN "category" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DiagnosisSession" ADD COLUMN     "errorCode" TEXT;
