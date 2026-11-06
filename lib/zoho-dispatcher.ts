import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type ZohoJourneyType, type ZohoOutboxEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSanitizedZohoError } from "@/lib/zoho-api";
import { ZohoApiError } from "@/lib/zoho-api-core";
import {
  getZohoDispatchConfiguration,
  getZohoJourneyConfiguration,
  getZohoListKey,
  getZohoTestConfiguration,
  getZohoTestJourneyConfiguration
} from "@/lib/zoho-config";
import { getPersistedZohoContactSnapshot } from "@/lib/zoho-contact-snapshot";
import type { ZohoDispatchProvider } from "@/lib/zoho-dispatch-provider";
import { zohoDispatchProvider } from "@/lib/zoho-dispatch-provider";
import { executeZohoProviderWorkflow } from "@/lib/zoho-dispatch-engine";
import {
  evaluateJourneyApplicability,
  getZohoRetryDelayMs,
  isUncertainJourneyFailure
} from "@/lib/zoho-dispatch-rules";
import { blockZohoApi, reserveZohoApiCapacity } from "@/lib/zoho-throttle";

type ClaimedEvent = { event: ZohoOutboxEvent; claimId: string; contextVersion: number };
type FinalState = "SUCCEEDED" | "HELD" | "RETRY" | "DEAD" | "CANCELLED";
const MAX_ATTEMPTS = 5;

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

function getJourneyKeys(journey: ZohoJourneyType, mode: "test" | "production") {
  const production = getZohoJourneyConfiguration()[journey];
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
  const plan = await prisma.onboardingPlan.findUnique({
    where: { id: event.onboardingPlanId },
    select: {
      automationEnrollmentState: true,
      kickoffBookedAt: true,
      nudgeStatus: true,
      nudgeTaskKey: true,
      planId: true,
      tenantType: true,
      onboardingTasks: { orderBy: { order: "asc" }, select: { owner: true, status: true, templateKey: true } },
      planContacts: {
        where: { normalizedEmail: event.recipientEmailNormalized, automationEnabled: true },
        select: { id: true, role: true, subscriptionStatus: true }
      }
    }
  });
  if (!plan) return null;
  const contact = plan.planContacts[0];
  const currentTask = plan.onboardingTasks.find((task) => task.status !== "complete") ?? plan.onboardingTasks.at(-1) ?? null;
  const milestoneCompleted = plan.onboardingTasks.some(
    (task) => task.templateKey === "complete-first-customer-rollout" && task.status === "complete"
  );
  return { contact, currentTask, milestoneCompleted, plan };
}

async function processClaim(claim: ClaimedEvent, provider: ZohoDispatchProvider) {
  const started = Date.now();
  const config = getZohoDispatchConfiguration();
  const done = (input: Omit<Parameters<typeof finishClaim>[1], "durationMs">) =>
    finishClaim(claim, { ...input, durationMs: Date.now() - started });
  if (config.globalKillSwitch) return done({ status: "HELD", reason: "GLOBAL_KILL_SWITCH_ENABLED" });
  if (config.mode === "disabled") return done({ status: "HELD", reason: "DISPATCH_MODE_DISABLED" });
  const state = await loadDispatchState(claim.event);
  if (!state?.contact) return done({ status: "CANCELLED", reason: "RECIPIENT_NO_LONGER_ASSIGNED" });
  const allowedPlanState = claim.event.isStopState
    ? ["ACTIVE", "PAUSED", "COMPLETE"].includes(state.plan.automationEnrollmentState)
    : state.plan.automationEnrollmentState === "ACTIVE";
  if (!allowedPlanState && claim.event.eventType === "UPSERT_CONTACT") {
    return done({ status: "CANCELLED", reason: "PLAN_NOT_ELIGIBLE_FOR_CONTACT_SYNCHRONIZATION" });
  }
  const test = getZohoTestConfiguration();
  if (config.mode === "test" && (!test.enabled || !test.allowedEmails.has(claim.event.recipientEmailNormalized) || !test.allowedPlanIds.has(state.plan.planId))) {
    return done({ status: "HELD", reason: "TEST_TARGET_NOT_ALLOWLISTED" });
  }
  if (config.mode === "production" && !config.productionApproved) {
    return done({ status: "HELD", reason: "PRODUCTION_DISPATCH_NOT_APPROVED" });
  }
  if (state.contact.subscriptionStatus === "INELIGIBLE") {
    const reason = claim.event.isStopState ? "CRITICAL_STOP_STATE_RECIPIENT_SUPPRESSED" : "RECIPIENT_INELIGIBLE";
    return done({ status: "HELD", reason });
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

  let journeyRequestStarted = false;
  let apiOperation: "CONTACT_SYNC" | "JOURNEY_TRIGGER" = "CONTACT_SYNC";
  try {
    if (!config.contactSyncEnabled) return done({ status: "HELD", reason: "CONTACT_SYNCHRONIZATION_DISABLED" });
    if (process.env.ZMA_FIELD_MAPPING_VERIFIED?.toLowerCase() !== "true" || process.env.ZMA_PRIVATE_LIST_VERIFIED?.toLowerCase() !== "true") {
      return done({ status: "HELD", reason: "ZOHO_MAPPING_OR_PRIVATE_LIST_UNVERIFIED" });
    }
    const snapshot = await getPersistedZohoContactSnapshot(state.plan.planId, state.contact.id);
    const contactCapacity = await reserveZohoApiCapacity("CONTACT_SYNC");
    if (!contactCapacity.allowed) return done({ status: "RETRY", reason: "CONTACT_SYNC_RATE_LIMITED", retryAt: contactCapacity.retryAt });
    if (claim.event.eventType === "UPSERT_CONTACT") {
      const result = await executeZohoProviderWorkflow({ provider, snapshot: snapshot.snapshot });
      return done({ status: "SUCCEEDED", outcome: result.contact.classification });
    }
    if (!config.journeyTriggeringEnabled || !claim.event.journey) return done({ status: "HELD", reason: "JOURNEY_TRIGGERING_DISABLED" });
    const journey = getJourneyKeys(claim.event.journey, config.mode);
    const listKey = getZohoListKey();
    if (!listKey) return done({ status: "HELD", reason: "LIST_CONFIGURATION_MISSING" });
    apiOperation = "JOURNEY_TRIGGER";
    const workflow = await executeZohoProviderWorkflow({
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
    if (sanitized.kind === "RATE_LIMIT") {
      const retryAt = new Date(Date.now() + Math.max((sanitized.retryAfterSeconds ?? 1800) * 1000, 60_000));
      await blockZohoApi(apiOperation, retryAt);
      return done({ status: "RETRY", reason, retryAt });
    }
    if (["INVALID_JOURNEY", "INACTIVE_JOURNEY", "INVALID_TRIGGER", "CONFIGURATION"].includes(sanitized.kind)) {
      return done({ status: "HELD", reason, journeyResult: "FAILED", journeyMetadata: { kind: sanitized.kind } });
    }
    if (["INVALID_LIST", "INVALID_TOPIC", "INVALID_EMAIL", "GROUP_EMAIL", "MISSING_FIELD"].includes(sanitized.kind)) {
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
  if (config.globalKillSwitch || config.mode === "disabled") {
    return { claimed: 0, completed: 0, recoveredExpiredClaims: 0, disabled: true };
  }
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
