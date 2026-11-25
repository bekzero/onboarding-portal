import "server-only";

import type { Prisma } from "@prisma/client";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoExactEventConfiguration,
  getZohoMspEnrollmentSyncConfiguration,
  getZohoTestConfiguration,
  getZohoTestJ1EnrollmentConfiguration,
  getZohoTopicId
} from "@/lib/zoho-config";
import { evaluateExactLifecycleMaintenance } from "@/lib/zoho-exact-lifecycle-maintenance-core";
import { createZohoAutomationAuditInTransaction, isZohoEventEmissionEnabled } from "@/lib/zoho-foundation";
import { getPersistedZohoContactSnapshot, getPersistedZohoContactSnapshotWithClient } from "@/lib/zoho-contact-snapshot";
import { prisma } from "@/lib/prisma";
import {
  getLinkedTestJ1ContactEventId,
  isApprovedTestJ1EventReason,
  isDefinitiveContactProviderOutcome,
  TEST_J1_RECONCILIATION_EVENT_REASON
} from "@/lib/zoho-test-j1-reconciliation-core";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

export const TEST_J1_CONTACT_VALUES_VERIFIED_ACTION = "test_j1.contact_values_verified";
export const TEST_J1_CONTACT_VALUES_CONFIRMATION = "VERIFY EXACT TEST J1 CONTACT VALUES";
export const TEST_J1_CONTACT_DISPATCH_CONFIRMATION = "DISPATCH ONE ALLOWLISTED TEST J1 CONTACT EVENT";
export const TEST_J1_JOURNEY_DISPATCH_CONFIRMATION = "DISPATCH ONE ALLOWLISTED TEST J1 JOURNEY EVENT";

function eventReason(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return typeof (event as Record<string, unknown>).reason === "string"
    ? (event as Record<string, unknown>).reason as string
    : null;
}

function eventTestJ1Authorization(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  return typeof record.testJ1KeyFingerprint === "string" &&
    typeof record.testJ1SelectionMode === "string"
    ? { fingerprint: record.testJ1KeyFingerprint, mode: record.testJ1SelectionMode }
    : null;
}

export async function getTestJ1LifecycleEvents(planId: string) {
  const events = await prisma.zohoOutboxEvent.findMany({
    where: {
      planId,
      OR: [
        { eventType: "UPSERT_CONTACT" },
        { eventType: "TRIGGER_JOURNEY", journey: "J1" }
      ]
    },
    orderBy: { sequence: "asc" },
    select: {
      attemptCount: true,
      createdAt: true,
      eventType: true,
      holdReason: true,
      id: true,
      journey: true,
      lastProviderOutcome: true,
      payload: true,
      planId: true,
      recipientEmailNormalized: true,
      sequence: true,
      status: true,
      updatedAt: true
    }
  });
  return events
    .filter((event) => isApprovedTestJ1EventReason(eventReason(event.payload)))
    .map(({ payload: _payload, sequence: _sequence, ...event }) => event);
}

async function loadExactLifecycleEvent(eventId: string, planId: string) {
  const event = await prisma.zohoOutboxEvent.findUnique({ where: { id: eventId } });
  if (!event || event.planId !== planId || !isApprovedTestJ1EventReason(eventReason(event.payload))) {
    throw new ZohoAdminValidationError("The requested event is not an allowlisted TEST J1 lifecycle event.", 403);
  }
  return event;
}

async function hasContactValueVerification(planInternalId: string, email: string, contactEventId: string) {
  return Boolean(await prisma.zohoAutomationAudit.findFirst({
    where: {
      action: TEST_J1_CONTACT_VALUES_VERIFIED_ACTION,
      actor: { startsWith: "oidc:" },
      evidenceReference: contactEventId,
      onboardingPlanId: planInternalId,
      recipientEmailNormalized: email
    },
    select: { id: true }
  }));
}

async function getJourneyContactDependency(event: Awaited<ReturnType<typeof loadExactLifecycleEvent>>) {
  if (event.eventType !== "TRIGGER_JOURNEY") return null;
  const linkedId = getLinkedTestJ1ContactEventId(event.payload);
  if (eventReason(event.payload) === TEST_J1_RECONCILIATION_EVENT_REASON && !linkedId) return null;
  if (linkedId) {
    const linked = await prisma.zohoOutboxEvent.findUnique({ where: { id: linkedId } });
    return linked &&
      linked.onboardingPlanId === event.onboardingPlanId &&
      linked.recipientEmailNormalized === event.recipientEmailNormalized &&
      linked.eventType === "UPSERT_CONTACT" &&
      linked.sequence < event.sequence
      ? linked
      : null;
  }
  return prisma.zohoOutboxEvent.findFirst({
    where: {
      onboardingPlanId: event.onboardingPlanId,
      recipientEmailNormalized: event.recipientEmailNormalized,
      eventType: "UPSERT_CONTACT",
      sequence: { lt: event.sequence }
    },
    orderBy: { sequence: "desc" }
  });
}

export async function recordTestJ1ContactValuesVerification(input: {
  actor: string;
  confirmation: string;
  contactEventId: string;
  evidenceReference: string;
  planId: string;
}) {
  const dispatch = getZohoDispatchConfiguration();
  if (
    !dispatch.globalKillSwitch ||
    dispatch.mode !== "disabled" ||
    dispatch.contactSyncEnabled ||
    dispatch.exactEventDispatchEnabled ||
    dispatch.automaticDispatchEnabled ||
    dispatch.journeyTriggeringEnabled ||
    dispatch.productionApproved
  ) {
    throw new ZohoAdminValidationError("Record independent TEST J1 field verification only after restoring the dormant Zoho configuration.", 409);
  }
  if (input.confirmation !== TEST_J1_CONTACT_VALUES_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact TEST J1 contact-value verification phrase.");
  }
  if (input.evidenceReference.trim().length < 8) {
    throw new ZohoAdminValidationError("Provide an independent Zoho field-verification evidence reference.");
  }
  const event = await loadExactLifecycleEvent(input.contactEventId, input.planId);
  if (event.eventType !== "UPSERT_CONTACT" || event.status !== "SUCCEEDED") {
    throw new ZohoAdminValidationError("Only a successfully processed TEST J1 contact event can be independently verified.", 409);
  }
  if (!isDefinitiveContactProviderOutcome(event.lastProviderOutcome)) {
    throw new ZohoAdminValidationError("The contact event has an uncertain or incomplete provider outcome.", 409);
  }
  const test = getZohoTestConfiguration();
  if (
    test.allowedPlanIds.size !== 1 || !test.allowedPlanIds.has(event.planId) ||
    test.allowedEmails.size !== 1 || !test.allowedEmails.has(event.recipientEmailNormalized)
  ) throw new ZohoAdminValidationError("The exact TEST J1 plan and recipient are not safely allowlisted.", 403);

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-test-j1-contact-verification:${event.id}`}, 0))`;
    const current = await transaction.zohoOutboxEvent.findUnique({ where: { id: event.id } });
    if (
      !current ||
      current.status !== "SUCCEEDED" ||
      current.attemptCount !== event.attemptCount ||
      !isDefinitiveContactProviderOutcome(current.lastProviderOutcome)
    ) {
      throw new ZohoAdminValidationError("The contact event changed. Reinspect it before recording verification.", 409);
    }
    const contact = await transaction.planContact.findFirst({
      where: {
        onboardingPlanId: event.onboardingPlanId,
        normalizedEmail: event.recipientEmailNormalized,
        role: "ONBOARDING_OWNER"
      },
      select: { id: true, subscriptionStatus: true }
    });
    const payload = current.payload && typeof current.payload === "object" && !Array.isArray(current.payload)
      ? current.payload as Record<string, unknown>
      : null;
    if (!contact || contact.subscriptionStatus !== "CONFIRMED" || !payload?.snapshot) {
      throw new ZohoAdminValidationError("Confirmed subscription eligibility and a complete contact snapshot are required.", 409);
    }
    const persisted = await getPersistedZohoContactSnapshotWithClient(transaction, event.planId, contact.id);
    if (JSON.stringify(payload.snapshot) !== JSON.stringify(persisted.snapshot)) {
      throw new ZohoAdminValidationError("The contact snapshot changed after synchronization. Prepare another reviewed reconciliation sequence.", 409);
    }
    const existing = await transaction.zohoAutomationAudit.findFirst({
      where: {
        action: TEST_J1_CONTACT_VALUES_VERIFIED_ACTION,
        evidenceReference: event.id,
        onboardingPlanId: event.onboardingPlanId,
        recipientEmailNormalized: event.recipientEmailNormalized
      },
      select: { id: true }
    });
    if (!existing) {
      await createZohoAutomationAuditInTransaction(transaction, {
        action: TEST_J1_CONTACT_VALUES_VERIFIED_ACTION,
        actor: input.actor,
        evidenceReference: event.id,
        onboardingPlanId: event.onboardingPlanId,
        planId: event.planId,
        reason: `An individually authenticated ADMIN independently compared the TEST J1 contact values with Zoho. Evidence: ${input.evidenceReference.trim().slice(0, 300)}. Only an explicitly linked replacement J1 may be released; no provider request occurred.`,
        recipientEmail: event.recipientEmailNormalized
      });
    }
    const released = await transaction.zohoOutboxEvent.updateMany({
      where: {
        eventType: "TRIGGER_JOURNEY",
        holdReason: "CONTACT_VALUES_NOT_VERIFIED",
        journey: "J1",
        onboardingPlanId: event.onboardingPlanId,
        payload: { path: ["event", "dependsOnContactEventId"], equals: event.id },
        recipientEmailNormalized: event.recipientEmailNormalized,
        status: "HELD"
      },
      data: { holdReason: null, nextAttemptAt: new Date(), status: "PENDING" }
    });
    if (released.count > 1) throw new ZohoAdminValidationError("More than one replacement J1 depended on the contact event.", 409);
    return { changed: !existing, releasedJourney: released.count === 1 } as const;
  });
}

export async function authorizeExactTestJ1LifecycleDispatch(input: {
  confirmation: string;
  eventId: string;
  planId: string;
}) {
  const event = await loadExactLifecycleEvent(input.eventId, input.planId);
  const expectedConfirmation = event.eventType === "UPSERT_CONTACT"
    ? TEST_J1_CONTACT_DISPATCH_CONFIRMATION
    : TEST_J1_JOURNEY_DISPATCH_CONFIRMATION;
  if (input.confirmation !== expectedConfirmation) {
    throw new ZohoAdminValidationError("Enter the exact confirmation phrase for the selected TEST J1 event.");
  }
  const [plan, contactVerification] = await Promise.all([
    prisma.onboardingPlan.findUnique({ where: { id: event.onboardingPlanId }, select: { id: true } }),
    getJourneyContactDependency(event)
  ]);
  if (!plan) throw new ZohoAdminValidationError("The TEST J1 plan no longer exists.", 409);
  const verified = contactVerification
    ? contactVerification.status === "SUCCEEDED" &&
      isDefinitiveContactProviderOutcome(contactVerification.lastProviderOutcome) &&
      await hasContactValueVerification(event.onboardingPlanId, event.recipientEmailNormalized, contactVerification.id)
    : event.eventType === "UPSERT_CONTACT";
  if (event.eventType === "TRIGGER_JOURNEY" && contactVerification) {
    const payload = contactVerification.payload && typeof contactVerification.payload === "object" && !Array.isArray(contactVerification.payload)
      ? contactVerification.payload as Record<string, unknown>
      : null;
    const contact = await prisma.planContact.findFirst({
      where: {
        onboardingPlanId: event.onboardingPlanId,
        normalizedEmail: event.recipientEmailNormalized,
        role: "ONBOARDING_OWNER"
      },
      select: { id: true }
    });
    if (!contact || !payload?.snapshot) {
      throw new ZohoAdminValidationError("The verified contact snapshot is unavailable.", 409);
    }
    const current = await getPersistedZohoContactSnapshot(event.planId, contact.id);
    if (JSON.stringify(payload.snapshot) !== JSON.stringify(current.snapshot)) {
      throw new ZohoAdminValidationError("The KZero contact snapshot changed after field verification. Prepare a new reviewed lifecycle sequence instead of triggering stale J1 data.", 409);
    }
  }
  const config = getZohoDispatchConfiguration();
  const status = getZohoConfigurationStatus();
  const test = getZohoTestConfiguration();
  const exact = getZohoExactEventConfiguration();
  const isolation = evaluateExactLifecycleMaintenance({
    allowedEmail: test.allowedEmails.size === 1 ? [...test.allowedEmails][0] : "",
    allowedEventIds: exact.allowedEventIds,
    allowedPlanId: test.allowedPlanIds.size === 1 ? [...test.allowedPlanIds][0] : "",
    automaticDispatchEnabled: config.automaticDispatchEnabled,
    contactSyncEnabled: config.contactSyncEnabled,
    contactVerificationRecorded: verified,
    event: {
      eventType: event.eventType,
      id: event.id,
      journey: event.journey === "J1" ? "J1" : null,
      planId: event.planId,
      reason: eventReason(event.payload),
      recipientEmailNormalized: event.recipientEmailNormalized,
      status: event.status
    },
    eventEmissionEnabled: isZohoEventEmissionEnabled(),
    exactEventDispatchEnabled: config.exactEventDispatchEnabled,
    fieldMappingVerified: status.fieldMappingVerified,
    globalKillSwitch: config.globalKillSwitch,
    journeyTriggeringEnabled: config.journeyTriggeringEnabled,
    legacyTestSyncEnabled: test.enabled,
    listKeyPresent: status.listKeyPresent,
    listPrivacyVerified: status.listPrivacyVerified,
    mode: config.mode,
    mspEnrollmentContactSyncEnabled: getZohoMspEnrollmentSyncConfiguration().enabled,
    nudgeEvaluationEnabled: status.nudgeEvaluationEnabled,
    oauthConfigured: status.oauthConfigured,
    productionApproved: config.productionApproved,
    singleContactPilotEnabled: status.singleContactPilotEnabled,
    testContactSyncEnabled: status.testContactSync.enabled,
    testFixtureEnabled:
      process.env.ZOHO_TEST_FIXTURE_ENABLED?.trim().toLowerCase() === "true" ||
      process.env.ZOHO_TEST_DATABASE_CONFIRMED?.trim().toLowerCase() === "true",
    testJ1EnrollmentEnabled: getZohoTestJ1EnrollmentConfiguration().enabled,
    topicIdValid: /^\d+$/.test(getZohoTopicId())
  });
  if (!isolation.allowed) {
    throw new ZohoAdminValidationError(`The exact TEST J1 maintenance posture is blocked: ${isolation.blockers.join(", ")}.`, 409);
  }
  const testJ1Configuration = getZohoTestJ1EnrollmentConfiguration();
  if (
    event.planId !== testJ1Configuration.approvedPlanId ||
    event.recipientEmailNormalized !== testJ1Configuration.approvedRecipient ||
    !testJ1Configuration.targetConfigured
  ) {
    throw new ZohoAdminValidationError(
      "Only the approved BenMSP E2E TEST J1 plan and recipient are eligible.",
      403
    );
  }
  if (event.eventType === "TRIGGER_JOURNEY" && testJ1Configuration.usesProductionJ1) {
    const authorization = eventTestJ1Authorization(event.payload);
    if (
      authorization?.mode !== testJ1Configuration.j1SelectionMode ||
      !authorization.fingerprint ||
      authorization.fingerprint !== testJ1Configuration.j1KeyFingerprint
    ) {
      throw new ZohoAdminValidationError(
        "The verified Production J1 configuration changed after intent preparation.",
        409
      );
    }
    const approval = await prisma.zohoAutomationAudit.findFirst({
      where: {
        action: "test_j1.production_journey_reuse_approved",
        actor: { startsWith: "oidc:" },
        evidenceReference: { not: null },
        onboardingPlanId: event.onboardingPlanId,
        recipientEmailNormalized: event.recipientEmailNormalized
      },
      select: { id: true }
    });
    if (!approval) {
      throw new ZohoAdminValidationError(
        "Production J1 reuse requires an attributable ADMIN review of re-entry and delayed-reminder behavior.",
        409
      );
    }
  }
  return event;
}
