-- Phase 5 adds durable daily evaluation and per-plan decision records only.
-- It does not populate historical timestamps, enroll plans, or schedule jobs.

CREATE TYPE "ZohoNudgeRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ZohoNudgeDecisionStatus" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'BLOCKED', 'PREPARED');

CREATE TABLE "zoho_nudge_evaluation_runs" (
  "id" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "ZohoNudgeRunStatus" NOT NULL DEFAULT 'RUNNING',
  "processingClaimId" TEXT NOT NULL,
  "processingLeaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "summary" JSONB,
  "lastSanitizedError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_nudge_evaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zoho_nudge_evaluation_decisions" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "onboardingPlanId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "recipientEmailNormalized" TEXT,
  "taskKey" TEXT,
  "status" "ZohoNudgeDecisionStatus" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "elapsedBusinessDays" INTEGER,
  "thresholdBusinessDays" INTEGER,
  "nextEligibleAt" TIMESTAMP(3),
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_nudge_evaluation_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zoho_nudge_decisions_elapsed_nonnegative" CHECK ("elapsedBusinessDays" IS NULL OR "elapsedBusinessDays" >= 0),
  CONSTRAINT "zoho_nudge_decisions_threshold_positive" CHECK ("thresholdBusinessDays" IS NULL OR "thresholdBusinessDays" > 0)
);

CREATE UNIQUE INDEX "zoho_nudge_evaluation_runs_businessDate_key"
ON "zoho_nudge_evaluation_runs"("businessDate");

CREATE INDEX "zoho_nudge_evaluation_runs_status_processingLeaseExpiresAt_idx"
ON "zoho_nudge_evaluation_runs"("status", "processingLeaseExpiresAt");

CREATE UNIQUE INDEX "zoho_nudge_evaluation_decisions_runId_onboardingPlanId_key"
ON "zoho_nudge_evaluation_decisions"("runId", "onboardingPlanId");

CREATE INDEX "zoho_nudge_evaluation_decisions_businessDate_status_idx"
ON "zoho_nudge_evaluation_decisions"("businessDate", "status");

CREATE INDEX "zoho_nudge_evaluation_decisions_onboardingPlanId_evaluatedAt_idx"
ON "zoho_nudge_evaluation_decisions"("onboardingPlanId", "evaluatedAt");

CREATE INDEX "zoho_nudge_evaluation_decisions_reasonCode_evaluatedAt_idx"
ON "zoho_nudge_evaluation_decisions"("reasonCode", "evaluatedAt");

ALTER TABLE "zoho_nudge_evaluation_decisions"
ADD CONSTRAINT "zoho_nudge_evaluation_decisions_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "zoho_nudge_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zoho_nudge_evaluation_decisions"
ADD CONSTRAINT "zoho_nudge_evaluation_decisions_onboardingPlanId_fkey"
FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
