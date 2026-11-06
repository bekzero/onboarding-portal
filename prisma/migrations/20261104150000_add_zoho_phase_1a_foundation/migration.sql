-- Phase 1A is additive. It creates no contacts, contexts, outbox events,
-- journey sends, or audit rows and does not infer historical timestamps.

-- CreateEnum
CREATE TYPE "AutomationOrigin" AS ENUM ('LEGACY', 'NATIVE');
CREATE TYPE "AutomationEnrollmentState" AS ENUM ('EXCLUDED', 'PENDING', 'ACTIVE', 'PAUSED', 'COMPLETE');
CREATE TYPE "AutomationTaskMappingState" AS ENUM ('UNVERIFIED', 'VERIFIED', 'NEEDS_REVIEW');
CREATE TYPE "NudgeStatus" AS ENUM ('NONE', 'WAITING', 'DONE');
CREATE TYPE "PlanContactRole" AS ENUM ('ONBOARDING_OWNER', 'EXECUTIVE_SPONSOR', 'TECHNICAL_ADMIN');
CREATE TYPE "SubscriptionEligibilityStatus" AS ENUM ('UNKNOWN', 'PENDING_CONFIRMATION', 'CONFIRMED', 'INELIGIBLE', 'MANUAL_REVIEW');
CREATE TYPE "ZohoCommunicationContextState" AS ENUM ('UNASSIGNED', 'ACTIVE', 'RELEASE_PENDING', 'BLOCKED');
CREATE TYPE "ZohoOutboxEventType" AS ENUM ('UPSERT_CONTACT', 'TRIGGER_JOURNEY');
CREATE TYPE "ZohoJourneyType" AS ENUM ('J1', 'J3_R1', 'J5', 'J8');
CREATE TYPE "ZohoOutboxEventStatus" AS ENUM ('PENDING', 'HELD', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'DEAD', 'CANCELLED');
CREATE TYPE "ZohoJourneyResult" AS ENUM ('TRIGGERED', 'ALREADY_TRIGGERED', 'IGNORED', 'UNKNOWN', 'FAILED');

-- AlterTable: defaults apply to plans created after this migration. Existing
-- plans are explicitly classified as legacy/excluded below.
ALTER TABLE "onboarding_plans"
ADD COLUMN "automationOrigin" "AutomationOrigin" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN "automationEnrollmentState" "AutomationEnrollmentState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "automationTaskMappingState" "AutomationTaskMappingState" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "automaticJ1Allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "automationEnrolledAt" TIMESTAMP(3),
ADD COLUMN "automationEnrolledBy" TEXT,
ADD COLUMN "nextTaskSince" TIMESTAMP(3),
ADD COLUMN "kickoffBookedAt" TIMESTAMP(3),
ADD COLUMN "kickoffBookedBy" TEXT,
ADD COLUMN "assignedSeName" TEXT,
ADD COLUMN "assignedSeEmail" TEXT,
ADD COLUMN "assignedSeBookingUrl" TEXT,
ADD COLUMN "nudgeTaskKey" TEXT,
ADD COLUMN "nudgeStartedAt" TIMESTAMP(3),
ADD COLUMN "nudgeStatus" "NudgeStatus" NOT NULL DEFAULT 'NONE';

UPDATE "onboarding_plans"
SET
  "automationOrigin" = 'LEGACY',
  "automationEnrollmentState" = 'EXCLUDED',
  "automaticJ1Allowed" = false;

-- AlterTable: all historical timestamp values intentionally remain null.
ALTER TABLE "onboarding_tasks"
ADD COLUMN "templateKey" TEXT,
ADD COLUMN "statusChangedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

-- Backfill only exact, version-1 title/order matches. If duplicate persisted
-- tasks claim the same template slot, neither receives a key.
WITH "template_v1" ("templateKey", "taskOrder", "title") AS (
  VALUES
    ('book-kickoff', 0, 'Book Setup Call with Your KZero Sales Engineer'),
    ('import-your-passwords', 1, 'Import Your Passwords'),
    ('add-backup-administrators', 2, 'Add Backup Administrators'),
    ('add-employees-and-contractors', 3, 'Add Employees and Contractors'),
    ('share-vault-browser-extension-guidance', 4, 'Share Vault and Browser Extension Guidance'),
    ('submit-saas-applications-for-review', 5, 'Submit SaaS Applications for Review'),
    ('review-app-compatibility-prepare-onboarding-plan', 6, 'Review App Compatibility and Prepare the Onboarding Plan'),
    ('upload-onboarding-plan', 7, 'Upload the Onboarding Plan'),
    ('book-sso-implementation-session', 8, 'Book the SSO Implementation Session'),
    ('select-first-customer-pilot', 9, 'Select First Customer Pilot'),
    ('confirm-customer-readiness', 10, 'Confirm Customer Readiness'),
    ('kzero-reviews-pilot-plan', 11, 'KZero Reviews Pilot Plan'),
    ('book-customer-rollout-session', 12, 'Book Customer Rollout Session'),
    ('complete-first-customer-rollout', 13, 'Complete First Customer Rollout')
),
"candidate_matches" AS (
  SELECT
    task."id" AS "taskId",
    task."onboardingPlanId",
    template."templateKey"
  FROM "onboarding_tasks" task
  INNER JOIN "template_v1" template
    ON template."taskOrder" = task."order"
   AND template."title" = task."title"
),
"unambiguous_matches" AS (
  SELECT
    MIN("taskId") AS "taskId",
    "onboardingPlanId",
    "templateKey"
  FROM "candidate_matches"
  GROUP BY "onboardingPlanId", "templateKey"
  HAVING COUNT(*) = 1
)
UPDATE "onboarding_tasks" task
SET "templateKey" = match."templateKey"
FROM "unambiguous_matches" match
WHERE task."id" = match."taskId";

CREATE UNIQUE INDEX "onboarding_tasks_onboardingPlanId_templateKey_key"
ON "onboarding_tasks"("onboardingPlanId", "templateKey");

-- A historical plan is structurally verified only if it has exactly the full
-- v1 template. Enrollment remains EXCLUDED regardless of this result.
UPDATE "onboarding_plans" plan
SET "automationTaskMappingState" = CASE
  WHEN mapping."taskCount" = 14
   AND mapping."mappedCount" = 14
   AND mapping."distinctMappedCount" = 14
    THEN 'VERIFIED'::"AutomationTaskMappingState"
  ELSE 'NEEDS_REVIEW'::"AutomationTaskMappingState"
END
FROM (
  SELECT
    "onboardingPlanId",
    COUNT(*) AS "taskCount",
    COUNT("templateKey") AS "mappedCount",
    COUNT(DISTINCT "templateKey") AS "distinctMappedCount"
  FROM "onboarding_tasks"
  GROUP BY "onboardingPlanId"
) mapping
WHERE plan."id" = mapping."onboardingPlanId";

UPDATE "onboarding_plans"
SET "automationTaskMappingState" = 'NEEDS_REVIEW'
WHERE NOT EXISTS (
  SELECT 1
  FROM "onboarding_tasks" task
  WHERE task."onboardingPlanId" = "onboarding_plans"."id"
);

-- CreateTable
CREATE TABLE "plan_contacts" (
  "id" TEXT NOT NULL,
  "onboardingPlanId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "role" "PlanContactRole" NOT NULL,
  "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "subscriptionStatus" "SubscriptionEligibilityStatus" NOT NULL DEFAULT 'UNKNOWN',
  "subscriptionVerificationSource" TEXT,
  "subscriptionVerifiedBy" TEXT,
  "subscriptionVerifiedAt" TIMESTAMP(3),
  "subscriptionEvidenceReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "plan_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_contacts_normalized_email_check" CHECK ("normalizedEmail" = lower(btrim("email")))
);

CREATE TABLE "zoho_communication_contexts" (
  "recipientEmailNormalized" TEXT NOT NULL,
  "activePlanId" TEXT,
  "state" "ZohoCommunicationContextState" NOT NULL DEFAULT 'UNASSIGNED',
  "acquiredAt" TIMESTAMP(3),
  "acquiredBy" TEXT,
  "acquisitionReason" TEXT,
  "releaseRequestedAt" TIMESTAMP(3),
  "releaseRequestedBy" TEXT,
  "releaseReason" TEXT,
  "releasedAt" TIMESTAMP(3),
  "releasedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "verificationEvidence" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_communication_contexts_pkey" PRIMARY KEY ("recipientEmailNormalized"),
  CONSTRAINT "zoho_communication_contexts_normalized_email_check" CHECK ("recipientEmailNormalized" = lower(btrim("recipientEmailNormalized"))),
  CONSTRAINT "zoho_communication_contexts_owner_state_check" CHECK (
    ("state" = 'UNASSIGNED' AND "activePlanId" IS NULL)
    OR ("state" IN ('ACTIVE', 'RELEASE_PENDING') AND "activePlanId" IS NOT NULL)
    OR "state" = 'BLOCKED'
  )
);

CREATE TABLE "zoho_recipient_sequences" (
  "recipientEmailNormalized" TEXT NOT NULL,
  "nextSequence" BIGINT NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_recipient_sequences_pkey" PRIMARY KEY ("recipientEmailNormalized"),
  CONSTRAINT "zoho_recipient_sequences_normalized_email_check" CHECK ("recipientEmailNormalized" = lower(btrim("recipientEmailNormalized"))),
  CONSTRAINT "zoho_recipient_sequences_positive_check" CHECK ("nextSequence" > 0)
);

CREATE TABLE "zoho_outbox_events" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "onboardingPlanId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "recipientEmailNormalized" TEXT NOT NULL,
  "eventType" "ZohoOutboxEventType" NOT NULL,
  "journey" "ZohoJourneyType",
  "taskKey" TEXT,
  "handoffKey" TEXT,
  "payload" JSONB NOT NULL,
  "sequence" BIGINT NOT NULL,
  "status" "ZohoOutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "holdReason" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastSanitizedError" TEXT,
  "processingClaimId" TEXT,
  "processingClaimedAt" TIMESTAMP(3),
  "processingLeaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zoho_outbox_events_normalized_email_check" CHECK ("recipientEmailNormalized" = lower(btrim("recipientEmailNormalized"))),
  CONSTRAINT "zoho_outbox_events_positive_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "zoho_outbox_events_nonnegative_attempts_check" CHECK ("attemptCount" >= 0)
);

CREATE TABLE "zoho_journey_sends" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "onboardingPlanId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "recipientEmailNormalized" TEXT NOT NULL,
  "journey" "ZohoJourneyType" NOT NULL,
  "taskKey" TEXT,
  "handoffKey" TEXT,
  "providerResult" "ZohoJourneyResult" NOT NULL DEFAULT 'UNKNOWN',
  "attemptedAt" TIMESTAMP(3),
  "succeededAt" TIMESTAMP(3),
  "sanitizedResponseMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_journey_sends_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zoho_journey_sends_normalized_email_check" CHECK ("recipientEmailNormalized" = lower(btrim("recipientEmailNormalized")))
);

CREATE TABLE "zoho_automation_audits" (
  "id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "onboardingPlanId" TEXT,
  "planId" TEXT,
  "recipientEmailNormalized" TEXT,
  "reason" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "zoho_automation_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zoho_automation_audits_normalized_email_check" CHECK (
    "recipientEmailNormalized" IS NULL
    OR "recipientEmailNormalized" = lower(btrim("recipientEmailNormalized"))
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_contacts_onboardingPlanId_normalizedEmail_role_key"
ON "plan_contacts"("onboardingPlanId", "normalizedEmail", "role");
CREATE INDEX "plan_contacts_normalizedEmail_idx" ON "plan_contacts"("normalizedEmail");
CREATE INDEX "plan_contacts_onboardingPlanId_automationEnabled_idx" ON "plan_contacts"("onboardingPlanId", "automationEnabled");

CREATE INDEX "zoho_communication_contexts_activePlanId_state_idx"
ON "zoho_communication_contexts"("activePlanId", "state");

CREATE UNIQUE INDEX "zoho_outbox_events_eventKey_key" ON "zoho_outbox_events"("eventKey");
CREATE UNIQUE INDEX "zoho_outbox_events_recipientEmailNormalized_sequence_key"
ON "zoho_outbox_events"("recipientEmailNormalized", "sequence");
CREATE INDEX "zoho_outbox_events_status_nextAttemptAt_createdAt_idx"
ON "zoho_outbox_events"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "zoho_outbox_events_recipientEmailNormalized_status_idx"
ON "zoho_outbox_events"("recipientEmailNormalized", "status");
CREATE INDEX "zoho_outbox_events_onboardingPlanId_status_idx"
ON "zoho_outbox_events"("onboardingPlanId", "status");

CREATE UNIQUE INDEX "zoho_journey_sends_dedupeKey_key" ON "zoho_journey_sends"("dedupeKey");
CREATE INDEX "zoho_journey_sends_onboardingPlanId_journey_idx"
ON "zoho_journey_sends"("onboardingPlanId", "journey");
CREATE INDEX "zoho_journey_sends_recipientEmailNormalized_journey_idx"
ON "zoho_journey_sends"("recipientEmailNormalized", "journey");

CREATE INDEX "zoho_automation_audits_onboardingPlanId_createdAt_idx"
ON "zoho_automation_audits"("onboardingPlanId", "createdAt");
CREATE INDEX "zoho_automation_audits_recipientEmailNormalized_createdAt_idx"
ON "zoho_automation_audits"("recipientEmailNormalized", "createdAt");
CREATE INDEX "zoho_automation_audits_action_createdAt_idx"
ON "zoho_automation_audits"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "plan_contacts"
ADD CONSTRAINT "plan_contacts_onboardingPlanId_fkey"
FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zoho_communication_contexts"
ADD CONSTRAINT "zoho_communication_contexts_activePlanId_fkey"
FOREIGN KEY ("activePlanId") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zoho_outbox_events"
ADD CONSTRAINT "zoho_outbox_events_onboardingPlanId_fkey"
FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zoho_journey_sends"
ADD CONSTRAINT "zoho_journey_sends_onboardingPlanId_fkey"
FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "zoho_automation_audits"
ADD CONSTRAINT "zoho_automation_audits_onboardingPlanId_fkey"
FOREIGN KEY ("onboardingPlanId") REFERENCES "onboarding_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
