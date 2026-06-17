-- AlterTable
ALTER TABLE "onboarding_plans" ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'waiting_on_msp',
ADD COLUMN     "submittedAppCount" INTEGER NOT NULL DEFAULT 0;
