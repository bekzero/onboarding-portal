-- Phase 4 adds only dispatcher coordination and observability state.
-- It does not enqueue events, alter onboarding state, or enable dispatch.

CREATE TYPE "ZohoApiOperation" AS ENUM ('CONTACT_SYNC', 'JOURNEY_TRIGGER');

ALTER TABLE "zoho_communication_contexts"
ADD COLUMN "processingClaimId" TEXT,
ADD COLUMN "processingClaimedAt" TIMESTAMP(3),
ADD COLUMN "processingLeaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "zoho_outbox_events"
ADD COLUMN "isStopState" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastProcessingDurationMs" INTEGER,
ADD COLUMN "lastProviderOutcome" TEXT;

CREATE TABLE "zoho_api_throttles" (
  "operation" "ZohoApiOperation" NOT NULL,
  "windowStartedAt" TIMESTAMP(3),
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zoho_api_throttles_pkey" PRIMARY KEY ("operation"),
  CONSTRAINT "zoho_api_throttles_nonnegative_count_check" CHECK ("requestCount" >= 0)
);

CREATE INDEX "zoho_communication_contexts_processingLeaseExpiresAt_idx"
ON "zoho_communication_contexts"("processingLeaseExpiresAt");

CREATE INDEX "zoho_outbox_events_status_isStopState_nextAttemptAt_createdAt_idx"
ON "zoho_outbox_events"("status", "isStopState", "nextAttemptAt", "createdAt");

CREATE INDEX "zoho_api_throttles_blockedUntil_idx"
ON "zoho_api_throttles"("blockedUntil");

ALTER TABLE "zoho_outbox_events"
ADD CONSTRAINT "zoho_outbox_events_nonnegative_duration_check"
CHECK ("lastProcessingDurationMs" IS NULL OR "lastProcessingDurationMs" >= 0);
