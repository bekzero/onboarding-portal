import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type ZohoJourneyType, type ZohoOutboxEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSanitizedZohoError } from "@/lib/zoho-api";
import { ZohoApiError } from "@/lib/zoho-api-core";
import {
  getZohoDispatchConfiguration,
  getZohoExactEventConfiguration,
  getZohoJourneyConfiguration,
  getZohoListKey,
  getZohoMspEnrollmentPilotConfiguration,
  getZohoTestConfiguration,
  getZohoTestJ1EnrollmentConfiguration,
  getZohoTestJourneyConfiguration
} from "@/lib/zoho-config";
import { getPersistedZohoContactSnapshot } from "@/lib/zoho-contact-snapshot";
import { getFullFieldTestIntentKey } from "@/lib/zoho-existing-plan-test-intent";
import { getZohoJourneyFreshnessBlockers } from "@/lib/zoho-field-lifecycle";
import type { ZohoDispatchProvider } from "@/lib/zoho-dispatch-provider";
import { zohoDispatchProvider } from "@/lib/zoho-dispatch-provider";
import { executeZohoProviderWorkflow } from "@/lib/zoho-dispatch-engine";
import {
  evaluateJourneyApplicability,
  getZohoRetryDelayMs,
  isUncertainJourneyFailure
} from "@/lib/zoho-dispatch-rules";
import { blockZohoApi, reserveZohoApiCapacity } from "@/lib/zoho-throttle";
import { LEGACY_AUTOMATION_BLOCK_REASON } from "@/lib/zoho-legacy-eligibility";
import {
  getLinkedTestJ1ContactEventId,
  isApprovedTestJ1EventReason,
  isDefinitiveContactProviderOutcome,
  TEST_J1_RECONCILIATION_EVENT_REASON
} from "@/lib/zoho-test-j1-reconciliation-core";

type ClaimedEvent = { event: ZohoOutboxEvent; claimId: string; contextVersion: number };
type FinalState = "SUCCEEDED" | "HELD" | "RETRY" | "DEAD" | "CANCELLED";
const MAX_ATTEMPTS = 5;

async function quarantineLegacyQueuedEvents() {
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "zoho_outbox_events" event
    SET
      "status" = 'CANCELLED',
      "holdReason" = ${LEGACY_AUTOMATION_BLOCK_REASON},
      "nextAttemptAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE (event."status" = 'PENDING' OR event."status" = 'RETRY' OR event."status" = 'HELD')
      AND EXISTS (
        SELECT 1 FROM "zoho_legacy_automation_plans" legacy
        WHERE legacy."onboardingPlanId" = event."onboardingPlanId"
      )
  `);
}

function getEventReason(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return typeof (event as Record<string, unknown>).reason === "string"
    ? (event as Record<string, unknown>).reason as string
    : null;
}

function getTestJ1Authorization(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  return typeof record.testJ1KeyFingerprint === "string" &&
    typeof record.testJ1SelectionMode === "string"
    ? {
        fingerprint: record.testJ1KeyFingerprint,
        mode: record.testJ1SelectionMode
      }
    : null;
}

function safeText(value: string) {
  return value.replace(/[\r\n]/g, " ").slice(0, 300);
}

async function recoverExpiredClaims(now: Date) {
  const expired = await prisma.zohoOutboxEvent.findMany({
    where: { status: "PROCESSING", processingLeaseExpiresAt: { lt: now } },
    select: { id: true, processingClaimId: true, recipientEmailNormalized: true }
  });
  for (const event of expired) {
    await prisma.$transaction(async (transaction) => {
      const changed = await transaction.zohoOutboxEvent.updateMany({
        where: { id: event.id, status: "PROCESSING", processingClaimId: event.processingClaimId },
        data: {
          holdReason: "PROCESSING_LEASE_EXPIRED_OUTCOME_UNCERTAIN",
          lastProviderOutcome: "UNKNOWN",
          lastSanitizedError: "The worker lease expired; manual reconciliation is required before retrying.",
          processingClaimId: null,
          processingClaimedAt: null,
          processingLeaseExpiresAt: null,
          status: "HELD"
        }
      });
      if (changed.count) {
        await transaction.zohoCommunicationContext.updateMany({
          where: { recipientEmailNormalized: event.recipientEmailNormalized, processingClaimId: event.processingClaimId },
          data: { processingClaimId: null, processingClaimedAt: null, processingLeaseExpiresAt: null }
        });
      }
    });
  }
  return expired.length;
}

async function claimSelectedEvent(
  transaction: Prisma.TransactionClient,
  id: string,
  now: Date,
  leaseSeconds: number
): Promise<ClaimedEvent | null> {
  const event = await transaction.zohoOutboxEvent.findUnique({ where: { id } });
  if (!event) return null;
  const context = await transaction.zohoCommunicationContext.findUnique({
    where: { recipientEmailNormalized: event.recipientEmailNormalized }
  });
  if (!context || context.state !== "ACTIVE" || context.activePlanId !== event.onboardingPlanId) {
    await transaction.zohoOutboxEvent.update({
      where: { id }, data: { status: "HELD", holdReason: "COMMUNICATION_CONTEXT_CONFLICT" }
    });
    return null;
  }
  if (context.processingLeaseExpiresAt && context.processingLeaseExpiresAt > now) return null;
  const claimId = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  const claimedContext = await transaction.zohoCommunicationContext.updateMany({
    where: {
      recipientEmailNormalized: event.recipientEmailNormalized,
      version: context.version,
      OR: [{ processingLeaseExpiresAt: null }, { processingLeaseExpiresAt: { lte: now } }]
    },
    data: {
      processingClaimId: claimId,
      processingClaimedAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
      version: { increment: 1 }
    }
  });
  if (!claimedContext.count) return null;
  const contextVersion = context.version + 1;
  const claimedEvent = await transaction.zohoOutboxEvent.update({
    where: { id },
    data: {
      attemptCount: { increment: 1 },
      holdReason: null,
      lastAttemptAt: now,
      processingClaimId: claimId,
      processingClaimedAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
      status: "PROCESSING"
    }
  });
  return { event: claimedEvent, claimId, contextVersion };
}

async function claimNextEvent(now: Date, leaseSeconds: number): Promise<ClaimedEvent | null> {
  return prisma.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT event."id"
      FROM "zoho_outbox_events" event
      WHERE event."status" IN ('PENDING', 'RETRY')
        AND (event."nextAttemptAt" IS NULL OR event."nextAttemptAt" <= ${now})
        AND NOT EXISTS (
          SELECT 1 FROM "zoho_communication_contexts" busy
          WHERE busy."recipientEmailNormalized" = event."recipientEmailNormalized"
            AND busy."processingLeaseExpiresAt" > ${now}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "zoho_outbox_events" earlier
          WHERE earlier."recipientEmailNormalized" = event."recipientEmailNormalized"
            AND earlier."sequence" < event."sequence"
            AND earlier."status" NOT IN ('SUCCEEDED', 'CANCELLED')
        )
      ORDER BY event."isStopState" DESC, event."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const id = candidates[0]?.id;
    if (!id) return null;
    return claimSelectedEvent(transaction, id, now, leaseSeconds);
  });
}

async function claimEventById(eventId: string, now: Date, leaseSeconds: number): Promise<ClaimedEvent | null> {
  return prisma.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT event."id"
      FROM "zoho_outbox_events" event
      WHERE event."id" = ${eventId}
        AND event."status" IN ('PENDING', 'RETRY')
        AND (event."nextAttemptAt" IS NULL OR event."nextAttemptAt" <= ${now})
        AND NOT EXISTS (
          SELECT 1 FROM "zoho_communication_contexts" busy
          WHERE busy."recipientEmailNormalized" = event."recipientEmailNormalized"
            AND busy."processingLeaseExpiresAt" > ${now}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "zoho_outbox_events" earlier
          WHERE earlier."recipientEmailNormalized" = event."recipientEmailNormalized"
            AND earlier."sequence" < event."sequence"
            AND earlier."status" NOT IN ('SUCCEEDED', 'CANCELLED')
        )
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const id = candidates[0]?.id;
    return id ? claimSelectedEvent(transaction, id, now, leaseSeconds) : null;
  });
}

async function finishClaim(
  claim: ClaimedEvent,
  input: {
    status: FinalState;
    reason?: string;
    outcome?: string;
    retryAt?: Date;
    durationMs: number;
    journeyResult?: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED" | "UNKNOWN" | "FAILED";
    journeyMetadata?: object;
  }
) {
  return prisma.$transaction(async (transaction) => {
    const context = await transaction.zohoCommunicationContext.updateMany({
      where: {
        recipientEmailNormalized: claim.event.recipientEmailNormalized,
        processingClaimId: claim.claimId,
        version: claim.contextVersion
      },
      data: { processingClaimId: null, processingClaimedAt: null, processingLeaseExpiresAt: null }
    });
    if (!context.count) throw new Error("DISPATCH_FENCE_REJECTED");
    if (claim.event.journey && input.journeyResult) {
      await transaction.zohoJourneySend.updateMany({
        where: {
          onboardingPlanId: claim.event.onboardingPlanId,
          recipientEmailNormalized: claim.event.recipientEmailNormalized,
          journey: claim.event.journey,
          taskKey: claim.event.taskKey,
          handoffKey: claim.event.handoffKey
        },
        data: {
          attemptedAt: new Date(),
          providerResult: input.journeyResult,
          sanitizedResponseMetadata: input.journeyMetadata ?? {},
          succeededAt: input.journeyResult === "TRIGGERED" || input.journeyResult === "ALREADY_TRIGGERED" ? new Date() : null
        }
      });
    }
    const event = await transaction.zohoOutboxEvent.updateMany({
      where: { id: claim.event.id, processingClaimId: claim.claimId, status: "PROCESSING" },
      data: {
        holdReason: input.status === "HELD" || input.status === "CANCELLED" ? input.reason : null,
        lastProcessingDurationMs: input.durationMs,
        lastProviderOutcome: input.outcome ?? null,
        lastSanitizedError: input.status === "SUCCEEDED" ? null : input.reason,
        nextAttemptAt: input.retryAt ?? null,
        processingClaimId: null,
        processingClaimedAt: null,
        processingLeaseExpiresAt: null,
        status: input.status
      }
    });
    if (!event.count) throw new Error("DISPATCH_FENCE_REJECTED");
  });
}

function getJourneyKeys(
  journey: ZohoJourneyType,
  mode: "test" | "production",
  allowExactProductionJ1Reuse = false
) {
  const production = getZohoJourneyConfiguration()[journey];
  if (
    mode === "test" &&
    journey === "J1" &&
    allowExactProductionJ1Reuse &&
    getZohoTestJ1EnrollmentConfiguration().usesProductionJ1
  ) {
    if (!production.journeyKey || !production.triggerKey) {
      throw new ZohoApiError("Verified Production J1 configuration is incomplete.", "CONFIGURATION");
    }
    return production;
  }
  const selected = mode === "test" ? getZohoTestJourneyConfiguration()[journey] : production;
  if (!selected.journeyKey || !selected.triggerKey) {
    throw new ZohoApiError("Journey configuration is incomplete.", "CONFIGURATION");
  }
  if (mode === "test" && (selected.journeyKey === production.journeyKey || selected.triggerKey === production.triggerKey)) {
    throw new ZohoApiError("Test journey configuration must differ from production.", "CONFIGURATION");
  }
  return selected;
}

async function loadDispatchState(event: ZohoOutboxEvent) {
  const [plan, permissionAudit] = await Promise.all([prisma.onboardingPlan.findUnique({
    where: { id: event.onboardingPlanId },
    select: {
      automationEnrollmentState: true,
      kickoffBookedAt: true,
      nudgeStatus: true,
      nudgeTaskKey: true,
      planId: true,
      tenantType: true,
      zohoLegacyAutomationProtection: { select: { onboardingPlanId: true } },
      onboardingTasks: { orderBy: { order: "asc" }, select: { owner: true, status: true, templateKey: true } },
      planContacts: {
        where: { normalizedEmail: event.recipientEmailNormalized, automationEnabled: true },
        select: { id: true, role: true, subscriptionStatus: true }
      }
    }
  }), prisma.zohoAutomationAudit.findFirst({
    where: {
      action: "msp_enrollment.contact_permission_recorded",
      actor: { startsWith: "oidc:" },
      onboardingPlanId: event.onboardingPlanId,
      recipientEmailNormalized: event.recipientEmailNormalized
    },
    select: { id: true }
  })]);
  if (!plan) return null;
  const contact = plan.planContacts[0];
  const currentTask = plan.onboardingTasks.find((task) => task.status !== "complete") ?? plan.onboardingTasks.at(-1) ?? null;
  const milestoneCompleted = plan.onboardingTasks.some(
    (task) => task.templateKey === "complete-first-customer-rollout" && task.status === "complete"
  );
  return { contact, contactPermissionRecorded: Boolean(permissionAudit), currentTask, milestoneCompleted, plan };
}

async function processClaim(claim: ClaimedEvent, provider: ZohoDispatchProvider) {
  const started = Date.now();
  const config = getZohoDispatchConfiguration();
  const done = (input: Omit<Parameters<typeof finishClaim>[1], "durationMs">) =>
    finishClaim(claim, { ...input, durationMs: Date.now() - started });
  const pendingContactVerification = () => claim.event.attemptCount >= MAX_ATTEMPTS
    ? done({
        status: "HELD",
        reason: "CONTACT_MEMBERSHIP_UNVERIFIED_AFTER_ACCEPTANCE",
        outcome: "ACCEPTED_PENDING_VERIFICATION"
      })
    : done({
        status: "RETRY",
        reason: "CONTACT_MEMBERSHIP_PENDING_VERIFICATION",
        outcome: "ACCEPTED_PENDING_VERIFICATION",
        retryAt: new Date(Date.now() + getZohoRetryDelayMs(claim.event.attemptCount))
      });
  if (config.globalKillSwitch) return done({ status: "HELD", reason: "GLOBAL_KILL_SWITCH_ENABLED" });
  if (config.mode === "disabled") return done({ status: "HELD", reason: "DISPATCH_MODE_DISABLED" });
  const state = await loadDispatchState(claim.event);
  if (state?.plan.zohoLegacyAutomationProtection) {
    return done({ status: "CANCELLED", reason: LEGACY_AUTOMATION_BLOCK_REASON });
  }
  if (!state?.contact) return done({ status: "CANCELLED", reason: "RECIPIENT_NO_LONGER_ASSIGNED" });
  const allowedPlanState = claim.event.isStopState
    ? ["ACTIVE", "PAUSED", "COMPLETE"].includes(state.plan.automationEnrollmentState)
    : state.plan.automationEnrollmentState === "ACTIVE";
  if (!allowedPlanState && claim.event.eventType === "UPSERT_CONTACT") {
    return done({ status: "CANCELLED", reason: "PLAN_NOT_ELIGIBLE_FOR_CONTACT_SYNCHRONIZATION" });
  }
  const test = getZohoTestConfiguration();
  let exactTestJ1Journey = false;
  if (config.mode === "test") {
    const target = getZohoMspEnrollmentPilotConfiguration();
    const exact = getZohoExactEventConfiguration();
    const testJ1 = getZohoTestJ1EnrollmentConfiguration();
    const exactTestTarget =
      testJ1.targetConfigured &&
      test.allowedPlanIds.size === 1 &&
      test.allowedPlanIds.has(state.plan.planId) &&
      test.allowedEmails.size === 1 &&
      test.allowedEmails.has(claim.event.recipientEmailNormalized);
    const exactTestJ1LifecycleEvent =
      exact.allowedEventIds.size === 1 &&
      exact.allowedEventIds.has(claim.event.id) &&
      exactTestTarget &&
      isApprovedTestJ1EventReason(getEventReason(claim.event.payload)) &&
      (claim.event.eventType === "UPSERT_CONTACT" ||
        (claim.event.eventType === "TRIGGER_JOURNEY" && claim.event.journey === "J1"));
    exactTestJ1Journey = exactTestJ1LifecycleEvent && claim.event.eventType === "TRIGGER_JOURNEY";
    const exactEventAllowed =
      config.exactEventDispatchEnabled &&
      (exactTestJ1LifecycleEvent || (
        target.configured &&
        target.planId === state.plan.planId &&
        target.email === claim.event.recipientEmailNormalized &&
        claim.event.eventType === "UPSERT_CONTACT" &&
        claim.event.eventKey === getFullFieldTestIntentKey(target.planId, target.email)
      ));
    const legacyTestEventAllowed =
      !config.exactEventDispatchEnabled &&
      test.enabled &&
      test.allowedEmails.has(claim.event.recipientEmailNormalized) &&
      test.allowedPlanIds.has(state.plan.planId);
    if (!exactEventAllowed && !legacyTestEventAllowed) {
      return done({ status: "HELD", reason: "TEST_TARGET_NOT_ALLOWLISTED" });
    }
  }
  if (config.mode === "production" && !config.productionApproved) {
    return done({ status: "HELD", reason: "PRODUCTION_DISPATCH_NOT_APPROVED" });
  }
  if (state.contact.subscriptionStatus === "INELIGIBLE") {
    const reason = claim.event.isStopState ? "CRITICAL_STOP_STATE_RECIPIENT_SUPPRESSED" : "RECIPIENT_INELIGIBLE";
    return done({ status: "HELD", reason });
  }
  if (
    claim.event.eventType === "UPSERT_CONTACT" &&
    state.contact.subscriptionStatus !== "CONFIRMED" &&
    !state.contactPermissionRecorded
  ) {
    return done({ status: "HELD", reason: "CONTACT_PERMISSION_NOT_DOCUMENTED" });
  }
  if (claim.event.eventType === "TRIGGER_JOURNEY" && state.contact.subscriptionStatus !== "CONFIRMED") {
    return done({ status: "HELD", reason: "SUBSCRIPTION_NOT_CONFIRMED" });
  }
  if (claim.event.eventType === "TRIGGER_JOURNEY" && claim.event.journey) {
    const applicable = evaluateJourneyApplicability({
      automationState: state.plan.automationEnrollmentState,
      currentTask: state.currentTask,
      eventTaskKey: claim.event.taskKey,
      journey: claim.event.journey,
      kickoffBooked: Boolean(state.plan.kickoffBookedAt),
      nudgeStatus: state.plan.nudgeStatus,
      nudgeTaskKey: state.plan.nudgeTaskKey,
      tenantType: state.plan.tenantType,
      j8Approved: process.env.ZMA_J8_NFR_RULE_APPROVED?.toLowerCase() === "true",
      milestoneCompleted: state.milestoneCompleted
    });
    if (!applicable.applicable) return done({ status: "CANCELLED", reason: applicable.reason });
    const previous = await prisma.zohoJourneySend.findFirst({
      where: {
        onboardingPlanId: claim.event.onboardingPlanId,
        recipientEmailNormalized: claim.event.recipientEmailNormalized,
        journey: claim.event.journey,
        taskKey: claim.event.taskKey,
        handoffKey: claim.event.handoffKey
      }
    });
    if (previous?.attemptedAt && ["TRIGGERED", "ALREADY_TRIGGERED", "UNKNOWN"].includes(previous.providerResult)) {
      return done({ status: previous.providerResult === "UNKNOWN" ? "HELD" : "SUCCEEDED", reason: previous.providerResult === "UNKNOWN" ? "UNCERTAIN_PROVIDER_OUTCOME" : undefined, outcome: previous.providerResult });
    }
  }

  let contactWriteStarted = false;
  let journeyRequestStarted = false;
  let apiOperation: "CONTACT_SYNC" | "JOURNEY_TRIGGER" = "CONTACT_SYNC";
  try {
    if (!config.contactSyncEnabled) return done({ status: "HELD", reason: "CONTACT_SYNCHRONIZATION_DISABLED" });
    if (process.env.ZMA_FIELD_MAPPING_VERIFIED?.toLowerCase() !== "true" || process.env.ZMA_PRIVATE_LIST_VERIFIED?.toLowerCase() !== "true") {
      return done({ status: "HELD", reason: "ZOHO_MAPPING_OR_PRIVATE_LIST_UNVERIFIED" });
    }
    const snapshot = await getPersistedZohoContactSnapshot(state.plan.planId, state.contact.id);
    if (claim.event.eventType === "TRIGGER_JOURNEY" && claim.event.journey) {
      const freshnessBlockers = getZohoJourneyFreshnessBlockers(claim.event.journey, snapshot.snapshot);
      if (freshnessBlockers.length > 0) {
        return done({
          status: "HELD",
          reason: `CONTACT_FIELD_FRESHNESS_UNVERIFIED:${freshnessBlockers.join(",")}`
        });
      }
    }
    if (exactTestJ1Journey) {
      const linkedContactEventId = getLinkedTestJ1ContactEventId(claim.event.payload);
      const contactEvent = linkedContactEventId
        ? await prisma.zohoOutboxEvent.findUnique({ where: { id: linkedContactEventId } })
        : getEventReason(claim.event.payload) === TEST_J1_RECONCILIATION_EVENT_REASON
          ? null
          : await prisma.zohoOutboxEvent.findFirst({
              where: {
                onboardingPlanId: claim.event.onboardingPlanId,
                recipientEmailNormalized: claim.event.recipientEmailNormalized,
                eventType: "UPSERT_CONTACT",
                sequence: { lt: claim.event.sequence },
                status: "SUCCEEDED"
              },
              orderBy: { sequence: "desc" }
            });
      const contactEventMatches = Boolean(
        contactEvent &&
        contactEvent.onboardingPlanId === claim.event.onboardingPlanId &&
        contactEvent.recipientEmailNormalized === claim.event.recipientEmailNormalized &&
        contactEvent.eventType === "UPSERT_CONTACT" &&
        contactEvent.sequence < claim.event.sequence &&
        contactEvent.status === "SUCCEEDED" &&
        isDefinitiveContactProviderOutcome(contactEvent.lastProviderOutcome)
      );
      const contactPayload = contactEvent?.payload && typeof contactEvent.payload === "object" && !Array.isArray(contactEvent.payload)
        ? contactEvent.payload as Record<string, unknown>
        : null;
      const verification = contactEvent ? await prisma.zohoAutomationAudit.findFirst({
        where: {
          action: "test_j1.contact_values_verified",
          actor: { startsWith: "oidc:" },
          evidenceReference: contactEvent.id,
          onboardingPlanId: claim.event.onboardingPlanId,
          recipientEmailNormalized: claim.event.recipientEmailNormalized
        },
        select: { id: true }
      }) : null;
      if (
        !contactEventMatches ||
        !verification ||
        !contactPayload?.snapshot ||
        JSON.stringify(contactPayload.snapshot) !== JSON.stringify(snapshot.snapshot)
      ) {
        return done({ status: "HELD", reason: "TEST_J1_CONTACT_VALUES_STALE_OR_UNVERIFIED" });
      }
      if (getZohoTestJ1EnrollmentConfiguration().usesProductionJ1) {
        const testJ1Configuration = getZohoTestJ1EnrollmentConfiguration();
        const authorization = getTestJ1Authorization(claim.event.payload);
        if (
          authorization?.mode !== testJ1Configuration.j1SelectionMode ||
          !authorization.fingerprint ||
          authorization.fingerprint !== testJ1Configuration.j1KeyFingerprint
        ) {
          return done({ status: "HELD", reason: "TEST_J1_JOURNEY_CONFIGURATION_CHANGED" });
        }
        const approval = await prisma.zohoAutomationAudit.findFirst({
          where: {
            action: "test_j1.production_journey_reuse_approved",
            actor: { startsWith: "oidc:" },
            evidenceReference: { not: null },
            onboardingPlanId: claim.event.onboardingPlanId,
            recipientEmailNormalized: claim.event.recipientEmailNormalized
          },
          select: { id: true }
        });
        if (!approval) {
          return done({ status: "HELD", reason: "PRODUCTION_J1_REUSE_NOT_ADMIN_APPROVED" });
        }
      }
    }
    if (exactTestJ1Journey) {
      if (!config.journeyTriggeringEnabled || !claim.event.journey) return done({ status: "HELD", reason: "JOURNEY_TRIGGERING_DISABLED" });
      const journey = getJourneyKeys(claim.event.journey, config.mode, true);
      const listKey = getZohoListKey();
      if (!listKey) return done({ status: "HELD", reason: "LIST_CONFIGURATION_MISSING" });
      const triggerCapacity = await reserveZohoApiCapacity("JOURNEY_TRIGGER");
      if (!triggerCapacity.allowed) return done({ status: "RETRY", reason: "JOURNEY_TRIGGER_RATE_LIMITED", retryAt: triggerCapacity.retryAt });
      apiOperation = "JOURNEY_TRIGGER";
      journeyRequestStarted = true;
      const result = await provider.triggerJourney({
        journeyKey: journey.journeyKey,
        leadEmail: claim.event.recipientEmailNormalized,
        listKey,
        triggerKey: journey.triggerKey
      });
      if (result.classification === "IGNORED") return done({
        status: "DEAD", reason: "ZOHO_IGNORED_LEAD", outcome: result.classification,
        journeyResult: result.classification, journeyMetadata: { code: result.code, classification: result.classification }
      });
      return done({
        status: "SUCCEEDED", outcome: result.classification,
        journeyResult: result.classification, journeyMetadata: { code: result.code, classification: result.classification }
      });
    }
    const contactCapacity = await reserveZohoApiCapacity("CONTACT_SYNC");
    if (!contactCapacity.allowed) return done({ status: "RETRY", reason: "CONTACT_SYNC_RATE_LIMITED", retryAt: contactCapacity.retryAt });
    const contactOptions = {
      beforeWrite: () => { contactWriteStarted = true; },
      verificationOnly: claim.event.lastProviderOutcome === "ACCEPTED_PENDING_VERIFICATION"
    };
    if (claim.event.eventType === "UPSERT_CONTACT") {
      const result = await executeZohoProviderWorkflow({ contactOptions, provider, snapshot: snapshot.snapshot });
      if (result.contact.classification === "PENDING_VERIFICATION") {
        return pendingContactVerification();
      }
      return done({ status: "SUCCEEDED", outcome: result.contact.classification });
    }
    if (!config.journeyTriggeringEnabled || !claim.event.journey) return done({ status: "HELD", reason: "JOURNEY_TRIGGERING_DISABLED" });
    const journey = getJourneyKeys(claim.event.journey, config.mode);
    const listKey = getZohoListKey();
    if (!listKey) return done({ status: "HELD", reason: "LIST_CONFIGURATION_MISSING" });
    apiOperation = "JOURNEY_TRIGGER";
    const workflow = await executeZohoProviderWorkflow({
      contactOptions,
      provider,
      snapshot: snapshot.snapshot,
      beforeJourneyTrigger: async () => {
        const triggerCapacity = await reserveZohoApiCapacity("JOURNEY_TRIGGER");
        if (!triggerCapacity.allowed) {
          throw new ZohoApiError("The shared Zoho journey limit is currently locked.", "RATE_LIMIT", {
            retryAfterSeconds: Math.max(1, Math.ceil((triggerCapacity.retryAt.getTime() - Date.now()) / 1000))
          });
        }
        journeyRequestStarted = true;
      },
      journey: {
        journeyKey: journey.journeyKey,
        leadEmail: claim.event.recipientEmailNormalized,
        listKey,
        triggerKey: journey.triggerKey
      }
    });
    if (workflow.contact.classification === "PENDING_VERIFICATION") {
      return pendingContactVerification();
    }
    if (workflow.contact.classification === "PENDING_CONFIRMATION") {
      return done({
        status: "HELD",
        reason: "SUBSCRIPTION_CONFIRMATION_REQUIRED",
        outcome: workflow.contact.classification
      });
    }
    const result = workflow.journey!;
    if (result.classification === "IGNORED") return done({
      status: "DEAD", reason: "ZOHO_IGNORED_LEAD", outcome: result.classification,
      journeyResult: result.classification, journeyMetadata: { code: result.code, classification: result.classification }
    });
    return done({
      status: "SUCCEEDED", outcome: result.classification,
      journeyResult: result.classification, journeyMetadata: { code: result.code, classification: result.classification }
    });
  } catch (error) {
    const sanitized = getSanitizedZohoError(error);
    const reason = safeText(`${sanitized.kind}: ${sanitized.message}`);
    if (journeyRequestStarted && isUncertainJourneyFailure(sanitized.kind)) {
      return done({
        status: "HELD", reason: "UNCERTAIN_PROVIDER_OUTCOME", outcome: "UNKNOWN",
        journeyResult: "UNKNOWN", journeyMetadata: { kind: sanitized.kind }
      });
    }
    if (contactWriteStarted && isUncertainJourneyFailure(sanitized.kind)) {
      return done({
        status: "HELD",
        reason: "UNCERTAIN_CONTACT_SYNC_OUTCOME",
        outcome: "UNKNOWN"
      });
    }
    if (sanitized.kind === "RATE_LIMIT") {
      const retryAt = new Date(Date.now() + Math.max((sanitized.retryAfterSeconds ?? 1800) * 1000, 60_000));
      await blockZohoApi(apiOperation, retryAt);
      return done({ status: "RETRY", reason, retryAt });
    }
    if (["INVALID_JOURNEY", "INACTIVE_JOURNEY", "INVALID_TRIGGER", "CONFIGURATION"].includes(sanitized.kind)) {
      return done({ status: "HELD", reason, journeyResult: "FAILED", journeyMetadata: { kind: sanitized.kind } });
    }
    if (["INVALID_LIST", "INVALID_TOPIC", "INVALID_EMAIL", "GROUP_EMAIL", "MISSING_FIELD", "INELIGIBLE_RECIPIENT"].includes(sanitized.kind)) {
      return done({ status: "HELD", reason });
    }
    if (claim.event.attemptCount >= MAX_ATTEMPTS) return done({ status: "DEAD", reason });
    return done({
      status: "RETRY",
      reason,
      retryAt: new Date(Date.now() + getZohoRetryDelayMs(claim.event.attemptCount, sanitized.retryAfterSeconds))
    });
  }
}

export async function dispatchZohoOutboxBatch(input: { provider?: ZohoDispatchProvider; maxEvents?: number } = {}) {
  const config = getZohoDispatchConfiguration();
  if (config.exactEventDispatchEnabled || config.globalKillSwitch || config.mode === "disabled") {
    return { claimed: 0, completed: 0, recoveredExpiredClaims: 0, disabled: true };
  }
  await quarantineLegacyQueuedEvents();
  const recoveredExpiredClaims = await recoverExpiredClaims(new Date());
  let claimed = 0;
  let completed = 0;
  const maxEvents = Math.min(input.maxEvents ?? config.batchSize, config.batchSize);
  while (claimed < maxEvents) {
    const claim = await claimNextEvent(new Date(), config.leaseSeconds);
    if (!claim) break;
    claimed += 1;
    await processClaim(claim, input.provider ?? zohoDispatchProvider);
    completed += 1;
  }
  return { claimed, completed, recoveredExpiredClaims, disabled: false };
}

export async function dispatchExactZohoOutboxEvent(
  eventId: string,
  input: { provider?: ZohoDispatchProvider } = {}
) {
  const config = getZohoDispatchConfiguration();
  if (!config.exactEventDispatchEnabled || config.globalKillSwitch || config.mode === "disabled") {
    return { claimed: false, completed: false, disabled: true };
  }
  await quarantineLegacyQueuedEvents();
  const claim = await claimEventById(eventId, new Date(), config.leaseSeconds);
  if (!claim) return { claimed: false, completed: false, disabled: false };
  await processClaim(claim, input.provider ?? zohoDispatchProvider);
  return { claimed: true, completed: true, disabled: false };
}

export async function getZohoDispatcherSummary() {
  const [statuses, oldest, critical] = await Promise.all([
    prisma.zohoOutboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.zohoOutboxEvent.findFirst({ where: { status: { in: ["PENDING", "RETRY"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.zohoOutboxEvent.count({ where: { status: "HELD", holdReason: { startsWith: "CRITICAL_" } } })
  ]);
  return { criticalHeld: critical, oldestEligibleAt: oldest?.createdAt ?? null, statuses: Object.fromEntries(statuses.map((item) => [item.status, item._count._all])) };
}

export async function reconcileUncertainZohoEvent(input: {
  action: "CONFIRM_TRIGGERED" | "CONFIRM_NOT_TRIGGERED_RETRY" | "CANCEL";
  actor: string;
  eventId: string;
  evidenceReference: string;
  reason: string;
}) {
  if (!input.reason.trim() || !input.evidenceReference.trim()) {
    throw new Error("A reason and evidence reference are required.");
  }
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.zohoOutboxEvent.findUnique({ where: { id: input.eventId } });
    if (!event || event.eventType !== "TRIGGER_JOURNEY" || event.status !== "HELD" ||
      !["UNCERTAIN_PROVIDER_OUTCOME", "PROCESSING_LEASE_EXPIRED_OUTCOME_UNCERTAIN"].includes(event.holdReason ?? "")) {
      throw new Error("Only held journey events with uncertain outcomes can be reconciled.");
    }
    const eventStatus = input.action === "CONFIRM_TRIGGERED" ? "SUCCEEDED" : input.action === "CANCEL" ? "CANCELLED" : "RETRY";
    const ledgerResult = input.action === "CONFIRM_TRIGGERED" ? "TRIGGERED" : "FAILED";
    await transaction.zohoOutboxEvent.update({
      where: { id: event.id },
      data: {
        holdReason: input.action === "CANCEL" ? "ADMIN_RECONCILED_CANCELLED" : null,
        lastProviderOutcome: input.action === "CONFIRM_TRIGGERED" ? "TRIGGERED_MANUALLY_VERIFIED" : "NOT_TRIGGERED_MANUALLY_VERIFIED",
        nextAttemptAt: input.action === "CONFIRM_NOT_TRIGGERED_RETRY" ? new Date() : null,
        status: eventStatus
      }
    });
    await transaction.zohoJourneySend.updateMany({
      where: {
        onboardingPlanId: event.onboardingPlanId,
        recipientEmailNormalized: event.recipientEmailNormalized,
        journey: event.journey!, taskKey: event.taskKey, handoffKey: event.handoffKey
      },
      data: {
        providerResult: ledgerResult,
        sanitizedResponseMetadata: { evidenceReference: input.evidenceReference, manuallyReconciled: true },
        succeededAt: input.action === "CONFIRM_TRIGGERED" ? new Date() : null
      }
    });
    await transaction.zohoAutomationAudit.create({
      data: {
        action: `zoho.dispatch.reconciled.${input.action.toLowerCase()}`,
        actor: input.actor,
        evidenceReference: input.evidenceReference.trim(),
        onboardingPlanId: event.onboardingPlanId,
        planId: event.planId,
        reason: input.reason.trim(),
        recipientEmailNormalized: event.recipientEmailNormalized
      }
    });
    return { eventId: event.id, status: eventStatus };
  });
}
