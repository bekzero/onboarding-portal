import "server-only";

import { randomUUID } from "node:crypto";
import { getSanitizedZohoError, getZohoApiClient } from "@/lib/zoho-api";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoListKey,
  getZohoMspEnrollmentPilotConfiguration,
  getZohoMspEnrollmentSyncConfiguration,
  getZohoSingleContactPilotConfiguration,
  ZOHO_TEST_MAILING_LIST_NAME
} from "@/lib/zoho-config";
import { createZohoAutomationAuditInTransaction, isZohoEventEmissionEnabled } from "@/lib/zoho-foundation";
import { checkZohoListMembership } from "@/lib/zoho-phase2";
import {
  DOWNSTREAM_AUTOMATION_REVIEW_BLOCKED_ACTION,
  DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION,
  getIndividuallyRecordedPermission,
  getPersistedListPrivacyVerification,
  getPilotDownstreamAutomationVerification,
  getPilotSubscriptionConfirmation,
  loadConfiguredPilotPlan
} from "@/lib/zoho-pilot-admin";
import { prisma } from "@/lib/prisma";
import { assertZohoPlanAutomationEligible } from "@/lib/zoho-legacy-eligibility";
import {
  evaluateSingleContactPilotReadiness,
  executeSingleContactPilotCore,
  type PilotOutcome,
  type PilotReadiness
} from "@/lib/zoho-single-contact-pilot-core";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

export const SINGLE_CONTACT_PILOT_CONFIRMATION = "RUN SINGLE-CONTACT ZOHO PILOT";
export const PILOT_RESERVATION_ACTION = "msp_pilot.execution_reserved";
const PILOT_OUTCOME_ACTION = "msp_pilot.execution_outcome";

type PilotState = Awaited<ReturnType<typeof loadPilotState>>;

async function loadPilotState(planId: string) {
  const loaded = await loadConfiguredPilotPlan(planId);
  const [permission, context, listPrivacy, downstream, subscriptionConfirmation, reservation, lastOutcome, lastVerification, unresolvedEvent] = await Promise.all([
    getIndividuallyRecordedPermission(loaded.plan.id, loaded.owner.normalizedEmail),
    prisma.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail },
      select: { activePlanId: true, state: true }
    }),
    getPersistedListPrivacyVerification(),
    getPilotDownstreamAutomationVerification(loaded.plan.id, loaded.owner.normalizedEmail),
    getPilotSubscriptionConfirmation(loaded.plan.id, loaded.owner.normalizedEmail),
    prisma.zohoAutomationAudit.findFirst({
      where: {
        action: PILOT_RESERVATION_ACTION,
        onboardingPlanId: loaded.plan.id,
        recipientEmailNormalized: loaded.owner.normalizedEmail
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, id: true }
    }),
    prisma.zohoAutomationAudit.findFirst({
      where: {
        action: PILOT_OUTCOME_ACTION,
        onboardingPlanId: loaded.plan.id,
        recipientEmailNormalized: loaded.owner.normalizedEmail
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, evidenceReference: true, reason: true }
    }),
    prisma.zohoAutomationAudit.findFirst({
      where: {
        action: PILOT_OUTCOME_ACTION,
        onboardingPlanId: loaded.plan.id,
        recipientEmailNormalized: loaded.owner.normalizedEmail,
        OR: [
          { reason: { contains: "stage=membership_precheck" } },
          { reason: { contains: "stage=membership_verification" } },
          { reason: { contains: "stage=verification_only" } }
        ]
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    }),
    prisma.zohoOutboxEvent.findFirst({
      where: {
        onboardingPlanId: loaded.plan.id,
        eventKey: { startsWith: "contact-sync:msp-enrolled:" },
        status: { notIn: ["SUCCEEDED", "CANCELLED", "DEAD"] }
      },
      select: { id: true }
    })
  ]);
  return { ...loaded, context, downstream, lastOutcome, lastVerification, listPrivacy, permission, reservation, subscriptionConfirmation, unresolvedEvent };
}

function evaluateState(state: PilotState, staffAdminAuthorized: boolean): PilotReadiness {
  const dispatch = getZohoDispatchConfiguration();
  const configuration = getZohoConfigurationStatus();
  const pilot = getZohoMspEnrollmentPilotConfiguration();
  return evaluateSingleContactPilotReadiness({
    automaticDispatchEnabled: dispatch.automaticDispatchEnabled,
    communicationContextOwned: state.context?.state === "ACTIVE" && state.context.activePlanId === state.plan.id,
    contactSyncEnabled: dispatch.contactSyncEnabled,
    dispatchMode: dispatch.mode,
    downstreamAutomationVerified: state.downstream?.verified === true,
    eventEmissionEnabled: isZohoEventEmissionEnabled(),
    globalKillSwitch: dispatch.globalKillSwitch,
    journeyTriggeringEnabled: dispatch.journeyTriggeringEnabled,
    listPrivacyVerified: configuration.listPrivacyVerified || Boolean(state.listPrivacy),
    manualPilotEnabled: getZohoSingleContactPilotConfiguration().enabled,
    nudgeEvaluationEnabled: configuration.nudgeEvaluationEnabled,
    permissionConfirmed: Boolean(state.permission?.evidenceReference),
    pilotTargetConfigured: pilot.configured,
    pilotTargetMatches: pilot.planId === state.plan.planId && pilot.email === state.owner.normalizedEmail,
    planAndOwnerApproved: state.plan.automationEnrollmentState === "ACTIVE" && state.owner.automationEnabled,
    priorReservation: Boolean(state.reservation),
    productionApproved: dispatch.productionApproved,
    providerConfigured: configuration.oauthConfigured && configuration.listKeyPresent,
    staffAdminAuthorized,
    subscriptionEvidenceVerified: Boolean(state.subscriptionConfirmation?.evidenceReference),
    subscriptionStatus: state.owner.subscriptionStatus,
    syncOnEnrollmentEnabled: getZohoMspEnrollmentSyncConfiguration().enabled,
    testWritePathsEnabled:
      configuration.exactEventDispatchEnabled || configuration.testContactSync.enabled || configuration.testMode.enabled,
    unresolvedEnrollmentEvent: Boolean(state.unresolvedEvent)
  });
}

async function verifyFreshPrivateList() {
  const listKey = getZohoListKey();
  if (!listKey) throw new ZohoAdminValidationError("The Zoho mailing-list key is not configured.", 503);
  const discovery = await getZohoApiClient().discoverMailingLists({ maxPages: 10, pageSize: 100 });
  const matches = discovery.lists.filter(
    (list) => list.listKey === listKey && list.listName === ZOHO_TEST_MAILING_LIST_NAME
  );
  if (matches.length !== 1 || matches[0].isPublic !== false) {
    throw new ZohoAdminValidationError("Fresh Zoho evidence did not identify exactly one approved private KZero Partner Onboarding list.", 409);
  }
  return listKey;
}

async function membership(email: string) {
  const result = await checkZohoListMembership(email);
  return { complete: !result.truncated, listStatuses: result.listStatuses };
}

function outcomeFromReason(reason?: string | null): PilotOutcome | null {
  const match = reason?.match(/outcome=([A-Z_]+)/);
  return match?.[1] as PilotOutcome | undefined ?? null;
}

export async function getSingleContactPilotStatus(planId: string, staffAdminAuthorized: boolean) {
  try {
    const state = await loadPilotState(planId);
    const readiness = evaluateState(state, staffAdminAuthorized);
    return {
      destinationList: ZOHO_TEST_MAILING_LIST_NAME,
      downstreamAutomationReview: state.downstream ? {
        evidenceReference: staffAdminAuthorized ? state.downstream.evidenceReference : null,
        reviewedAt: state.downstream.createdAt,
        result: state.downstream.verified ? "NO_UNINTENDED_AUTOMATION" : "ACTIVE_AUTOMATION_FOUND"
      } : null,
      downstreamAutomationVerified: state.downstream?.verified === true,
      enabled: getZohoSingleContactPilotConfiguration().enabled,
      executionAuthorized: readiness.canExecute,
      lastAttemptAt: state.reservation?.createdAt ?? null,
      lastOutcome: outcomeFromReason(state.lastOutcome?.reason),
      lastVerificationAt: state.lastVerification?.createdAt ?? null,
      readiness,
      subscriptionConfirmation: state.subscriptionConfirmation ? {
        evidenceReference: staffAdminAuthorized ? state.subscriptionConfirmation.evidenceReference : null,
        recordedAt: state.subscriptionConfirmation.createdAt
      } : null,
      targetEmail: state.owner.email,
      targetMsp: state.plan.msp.name
    };
  } catch {
    return null;
  }
}

export async function previewSingleContactPilot(input: { planId: string; staffAdminAuthorized: boolean }) {
  const state = await loadPilotState(input.planId);
  const readiness = evaluateState(state, input.staffAdminAuthorized);
  if (!readiness.canPreview) {
    return { ...await getSingleContactPilotStatus(input.planId, input.staffAdminAuthorized), membership: null, previewedAt: new Date(), outcome: "BLOCKED" as const };
  }

  try {
    await verifyFreshPrivateList();
    const freshMembership = await membership(state.owner.email);
    const suppression = freshMembership.listStatuses.some((status) => status === "unsub" || status === "bounce");
    const active = freshMembership.listStatuses.includes("active");
    const outcome = !freshMembership.complete
      ? "UNABLE_TO_VERIFY"
      : suppression
        ? "BLOCKED"
        : active
          ? state.reservation ? "VERIFIED" : "ALREADY_EXISTS"
          : state.reservation
            ? "ACCEPTED_PENDING_VERIFICATION"
            : readiness.canExecute ? null : "BLOCKED";
    return {
      ...await getSingleContactPilotStatus(input.planId, input.staffAdminAuthorized),
      membership: { complete: freshMembership.complete, statuses: freshMembership.listStatuses },
      outcome,
      previewedAt: new Date()
    };
  } catch (error) {
    return {
      ...await getSingleContactPilotStatus(input.planId, input.staffAdminAuthorized),
      diagnostic: getSanitizedZohoError(error).kind,
      membership: null,
      outcome: "UNABLE_TO_VERIFY" as const,
      previewedAt: new Date()
    };
  }
}

async function recordOutcome(state: PilotState, actor: string, requestId: string, stage: string, outcome: PilotOutcome) {
  await prisma.$transaction((transaction) => createZohoAutomationAuditInTransaction(transaction, {
    action: PILOT_OUTCOME_ACTION,
    actor,
    evidenceReference: requestId,
    onboardingPlanId: state.plan.id,
    reason: `MSP=${state.plan.msp.name}; stage=${stage}; outcome=${outcome}; provider_write=${stage.startsWith("provider") || stage === "membership_verification" ? "possible" : "no"}`,
    recipientEmail: state.owner.email
  }));
}

async function reserveExecution(state: PilotState, actor: string) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-single-contact-pilot:${state.plan.id}:${state.owner.normalizedEmail}`}, 0))`;
    const existing = await transaction.zohoAutomationAudit.findFirst({
      where: {
        action: PILOT_RESERVATION_ACTION,
        onboardingPlanId: state.plan.id,
        recipientEmailNormalized: state.owner.normalizedEmail
      },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    if (existing) return { acquired: false, requestId: existing.id };

    // Re-read all consequential persisted state while holding the reservation lock.
    const [plan, context, permission, downstream, subscriptionConfirmation, unresolvedEvent] = await Promise.all([
      transaction.onboardingPlan.findUnique({
        where: { id: state.plan.id },
        select: {
          automationEnrollmentState: true,
          msp: { select: { primaryContactEmail: true } },
          planContacts: {
            where: { role: "ONBOARDING_OWNER", normalizedEmail: state.owner.normalizedEmail },
            take: 1,
            select: { automationEnabled: true, email: true, normalizedEmail: true, subscriptionStatus: true }
          }
        }
      }),
      transaction.zohoCommunicationContext.findUnique({ where: { recipientEmailNormalized: state.owner.normalizedEmail } }),
      transaction.zohoAutomationAudit.findFirst({
        where: {
          action: "msp_enrollment.contact_permission_recorded",
          actor: { startsWith: "oidc:" },
          onboardingPlanId: state.plan.id,
          recipientEmailNormalized: state.owner.normalizedEmail,
          evidenceReference: { not: null }
        }
      }),
      transaction.zohoAutomationAudit.findFirst({
        where: {
          action: { in: [DOWNSTREAM_AUTOMATION_REVIEW_BLOCKED_ACTION, DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION] },
          actor: { startsWith: "oidc:" },
          onboardingPlanId: state.plan.id,
          recipientEmailNormalized: state.owner.normalizedEmail
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      transaction.zohoAutomationAudit.findFirst({
        where: {
          action: "msp_pilot.subscription_confirmed",
          actor: { startsWith: "oidc:" },
          onboardingPlanId: state.plan.id,
          recipientEmailNormalized: state.owner.normalizedEmail,
          evidenceReference: { not: null }
        }
      }),
      transaction.zohoOutboxEvent.findFirst({
        where: {
          onboardingPlanId: state.plan.id,
          eventKey: { startsWith: "contact-sync:msp-enrolled:" },
          status: { notIn: ["SUCCEEDED", "CANCELLED", "DEAD"] }
        }
      })
    ]);
    const owner = plan?.planContacts[0];
    const dispatch = getZohoDispatchConfiguration();
    const pilot = getZohoMspEnrollmentPilotConfiguration();
    const currentConfiguration = getZohoConfigurationStatus();
    if (
      plan?.automationEnrollmentState !== "ACTIVE" || !owner?.automationEnabled || owner.subscriptionStatus === "INELIGIBLE" ||
      plan.msp.primaryContactEmail.trim().toLowerCase() !== state.owner.normalizedEmail || owner.normalizedEmail !== state.owner.normalizedEmail ||
      !pilot.configured || pilot.planId !== state.plan.planId || pilot.email !== state.owner.normalizedEmail ||
      context?.state !== "ACTIVE" || context.activePlanId !== state.plan.id || !permission || downstream?.action !== DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION || !subscriptionConfirmation || unresolvedEvent ||
      !getZohoSingleContactPilotConfiguration().enabled || dispatch.globalKillSwitch || dispatch.automaticDispatchEnabled ||
      dispatch.contactSyncEnabled || dispatch.journeyTriggeringEnabled || dispatch.productionApproved || dispatch.mode !== "disabled" ||
      isZohoEventEmissionEnabled() || getZohoMspEnrollmentSyncConfiguration().enabled ||
      currentConfiguration.exactEventDispatchEnabled || currentConfiguration.nudgeEvaluationEnabled ||
      currentConfiguration.testContactSync.enabled || currentConfiguration.testMode.enabled
    ) throw new ZohoAdminValidationError("Pilot readiness changed before the execution reservation could be created.", 409);

    const reservation = await createZohoAutomationAuditInTransaction(transaction, {
      action: PILOT_RESERVATION_ACTION,
      actor,
      onboardingPlanId: state.plan.id,
      reason: `MSP=${state.plan.msp.name}; durable single-use reservation created before the one-contact provider request. This reservation can never be reset or converted to outbox work.`,
      recipientEmail: state.owner.email
    });
    return { acquired: true, requestId: reservation.id };
  });
}

export async function executeSingleContactPilot(input: { actor: string; confirmation: string; planId: string }) {
  if (input.confirmation !== SINGLE_CONTACT_PILOT_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact one-contact pilot confirmation phrase.");
  }
  const state = await loadPilotState(input.planId);
  await assertZohoPlanAutomationEligible(prisma, state.plan.id);
  const readiness = evaluateState(state, true);
  const nonReservationBlockers = readiness.blockers.filter((blocker) => blocker !== "PILOT_EXECUTION_ALREADY_RESERVED");
  if (nonReservationBlockers.length) {
    await recordOutcome(state, input.actor, state.reservation?.id ?? randomUUID(), "authorization", "BLOCKED");
    throw new ZohoAdminValidationError(`The controlled pilot is blocked: ${nonReservationBlockers.join(", ")}.`, 409);
  }

  const listKey = await verifyFreshPrivateList();
  let requestId = state.reservation?.id ?? randomUUID();
  const result = await executeSingleContactPilotCore({
    add: async () => {
      const response = await getZohoApiClient().addLeadsInBulk({ emails: [state.owner.email], listKey });
      return response.results[0] ?? { classification: "ERROR" as const, providerCode: null };
    },
    check: () => membership(state.owner.email),
    record: (stage, outcome) => recordOutcome(state, input.actor, requestId, stage, outcome),
    reserve: async () => {
      const reservation = await reserveExecution(state, input.actor);
      requestId = reservation.requestId;
      return { acquired: reservation.acquired };
    }
  });
  return { ...result, requestId, target: { listName: ZOHO_TEST_MAILING_LIST_NAME, planId: state.plan.planId } };
}
