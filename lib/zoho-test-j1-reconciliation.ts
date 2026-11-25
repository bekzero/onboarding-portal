import "server-only";

import { Prisma } from "@prisma/client";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoExactEventConfiguration,
  getZohoMspEnrollmentSyncConfiguration,
  getZohoTestConfiguration,
  getZohoTestJ1EnrollmentConfiguration,
  getZohoTestJ1ReconciliationConfiguration
} from "@/lib/zoho-config";
import { getPersistedZohoContactSnapshotWithClient } from "@/lib/zoho-contact-snapshot";
import {
  createStableZohoKey,
  createZohoAutomationAuditInTransaction,
  createZohoContactSyncEventInTransaction,
  createZohoJourneyTriggerEventInTransaction,
  isZohoEventEmissionEnabled,
  type ZohoTransaction
} from "@/lib/zoho-foundation";
import { getZohoPlanAutomationEligibility } from "@/lib/zoho-legacy-eligibility";
import { prisma } from "@/lib/prisma";
import {
  getLinkedTestJ1ContactEventId,
  isDefinitiveContactProviderOutcome,
  TEST_J1_ORIGINAL_EVENT_REASON,
  TEST_J1_RECONCILIATION_EVENT_REASON
} from "@/lib/zoho-test-j1-reconciliation-core";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

export const TEST_J1_RECONCILIATION_CONFIRMATION = "PREPARE ONE TEST J1 SNAPSHOT RECONCILIATION";
export const TEST_J1_RECONCILIATION_AUDIT_ACTION = "test_j1.snapshot_reconciliation_prepared";
export const TEST_J1_RECONCILIATION_HOLD_REASON = "CONTACT_VALUES_NOT_VERIFIED";

type ReconciliationConfiguration = ReturnType<typeof getZohoTestJ1ReconciliationConfiguration>;

function eventReason(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return typeof (event as Record<string, unknown>).reason === "string"
    ? (event as Record<string, unknown>).reason as string
    : null;
}
function reconciliationKeys(planId: string, email: string, config: ReconciliationConfiguration) {
  const reconciliationId = createStableZohoKey(
    "test-j1-reconciliation-v1",
    config.originalContactEventId,
    config.originalJ1EventId
  );
  const occurrenceKey = `${reconciliationId}:${planId}`;
  const contactEventKey = createStableZohoKey("contact-sync", occurrenceKey, planId, email);
  const journeyDedupeKey = createStableZohoKey("journey", "J1", reconciliationId, planId, email);
  const journeyEventKey = createStableZohoKey("trigger", occurrenceKey, journeyDedupeKey);
  return { contactEventKey, journeyDedupeKey, journeyEventKey, occurrenceKey, reconciliationId };
}

function assertDormantReconciliationConfiguration(config: ReconciliationConfiguration) {
  const dispatch = getZohoDispatchConfiguration();
  const status = getZohoConfigurationStatus();
  const test = getZohoTestConfiguration();
  const exact = getZohoExactEventConfiguration();
  const testJ1 = getZohoTestJ1EnrollmentConfiguration();
  const exactTarget =
    test.allowedPlanIds.size === 1 &&
    test.allowedPlanIds.has(testJ1.approvedPlanId) &&
    test.allowedEmails.size === 1 &&
    test.allowedEmails.has(testJ1.approvedRecipient);

  if (!config.enabled || !config.originalContactEventId || !config.originalJ1EventId || !exactTarget) {
    throw new ZohoAdminValidationError("The exact TEST J1 reconciliation target is not configured.", 403);
  }
  if (
    !dispatch.globalKillSwitch ||
    dispatch.mode !== "disabled" ||
    dispatch.contactSyncEnabled ||
    dispatch.exactEventDispatchEnabled ||
    dispatch.automaticDispatchEnabled ||
    dispatch.journeyTriggeringEnabled ||
    dispatch.productionApproved ||
    isZohoEventEmissionEnabled() ||
    status.nudgeEvaluationEnabled ||
    getZohoMspEnrollmentSyncConfiguration().enabled ||
    status.singleContactPilotEnabled ||
    status.testContactSync.enabled ||
    test.enabled ||
    testJ1.enabled ||
    exact.allowedEventIds.size > 0 ||
    process.env.ZOHO_TEST_FIXTURE_ENABLED?.trim().toLowerCase() === "true" ||
    process.env.ZOHO_TEST_DATABASE_CONFIRMED?.trim().toLowerCase() === "true"
  ) {
    throw new ZohoAdminValidationError("TEST J1 reconciliation requires the fully dormant Zoho posture.", 409);
  }
  if (
    !status.oauthConfigured ||
    !status.listKeyPresent ||
    !status.listPrivacyVerified ||
    !status.fieldMappingVerified ||
    !status.topicIdPresent ||
    !testJ1.testJ1Configured
  ) {
    throw new ZohoAdminValidationError("Verified Zoho contact and J1 configuration is required.", 409);
  }
}

export async function reconcileTestJ1SnapshotInTransaction(
  transaction: ZohoTransaction,
  input: { actor: string; planId: string },
  config = getZohoTestJ1ReconciliationConfiguration()
) {
  const testJ1 = getZohoTestJ1EnrollmentConfiguration();
  if (
    input.planId !== testJ1.approvedPlanId ||
    !input.actor.startsWith("oidc:")
  ) {
    throw new ZohoAdminValidationError("Only an individually authenticated ADMIN may reconcile the exact TEST J1 plan.", 403);
  }
  const keys = reconciliationKeys(input.planId, testJ1.approvedRecipient, config);
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding-plan:${input.planId}`}, 0))
  `);
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${testJ1.approvedRecipient}`}, 0))
  `);
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-test-j1-reconcile:${input.planId}:${testJ1.approvedRecipient}`}, 0))
  `);

  const plan = await transaction.onboardingPlan.findUnique({
    where: { planId: input.planId },
    select: {
      automaticJ1Allowed: true,
      automationEnrollmentState: true,
      id: true,
      kickoffBookedAt: true,
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: { status: true, templateKey: true }
      },
      planContacts: {
        where: { normalizedEmail: testJ1.approvedRecipient, role: "ONBOARDING_OWNER" },
        take: 1,
        select: {
          automationEnabled: true,
          email: true,
          id: true,
          normalizedEmail: true,
          subscriptionEvidenceReference: true,
          subscriptionStatus: true,
          subscriptionVerifiedAt: true,
          subscriptionVerifiedBy: true
        }
      },
      planId: true
    }
  });
  const owner = plan?.planContacts[0];
  if (!plan || !owner) throw new ZohoAdminValidationError("The exact TEST J1 plan and owner were not found.", 404);
  const eligibility = await getZohoPlanAutomationEligibility(transaction, plan.id);
  if (!eligibility.allowed) throw new ZohoAdminValidationError(eligibility.reason, 409);
  if (
    plan.automationEnrollmentState !== "ACTIVE" ||
    !plan.automaticJ1Allowed ||
    !owner.automationEnabled ||
    owner.subscriptionStatus !== "CONFIRMED" ||
    !owner.subscriptionEvidenceReference ||
    !owner.subscriptionVerifiedAt ||
    !owner.subscriptionVerifiedBy
  ) {
    throw new ZohoAdminValidationError("The exact TEST J1 owner is not fully consented and automation eligible.", 409);
  }
  const currentTask = plan.onboardingTasks.find((task) => task.status !== "complete");
  if (currentTask?.templateKey !== "book-kickoff" || plan.kickoffBookedAt) {
    throw new ZohoAdminValidationError("The TEST J1 kickoff state changed and cannot be reconciled.", 409);
  }

  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "zoho_outbox_events"
    WHERE "id" IN (${config.originalContactEventId}, ${config.originalJ1EventId})
    ORDER BY "sequence" FOR UPDATE
  `);
  const [originalContact, originalJ1, context, permission, downstream, existingContact, existingJ1] = await Promise.all([
    transaction.zohoOutboxEvent.findUnique({ where: { id: config.originalContactEventId } }),
    transaction.zohoOutboxEvent.findUnique({ where: { id: config.originalJ1EventId } }),
    transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: owner.normalizedEmail },
      select: { activePlanId: true, processingClaimId: true, state: true }
    }),
    transaction.zohoAutomationAudit.findFirst({
      where: {
        action: "msp_enrollment.contact_permission_recorded",
        actor: { startsWith: "oidc:" },
        evidenceReference: { not: null },
        onboardingPlanId: plan.id,
        recipientEmailNormalized: owner.normalizedEmail
      },
      select: { id: true }
    }),
    transaction.zohoAutomationAudit.findFirst({
      where: {
        action: { in: ["msp_pilot.downstream_automation_review_passed", "msp_pilot.downstream_automation_review_blocked"] },
        onboardingPlanId: plan.id,
        recipientEmailNormalized: owner.normalizedEmail
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, actor: true, evidenceReference: true }
    }),
    transaction.zohoOutboxEvent.findUnique({ where: { eventKey: keys.contactEventKey } }),
    transaction.zohoOutboxEvent.findUnique({ where: { eventKey: keys.journeyEventKey } })
  ]);

  if (
    context?.state !== "ACTIVE" ||
    context.activePlanId !== plan.id ||
    context.processingClaimId ||
    !permission ||
    downstream?.action !== "msp_pilot.downstream_automation_review_passed" ||
    !downstream.actor.startsWith("oidc:") ||
    !downstream.evidenceReference
  ) {
    throw new ZohoAdminValidationError("Communication ownership, permission, or downstream review is incomplete.", 409);
  }

  if (existingContact || existingJ1) {
    if (
      !existingContact ||
      !existingJ1 ||
      existingJ1.status !== "HELD" ||
      getLinkedTestJ1ContactEventId(existingJ1.payload) !== existingContact.id ||
      originalJ1?.status !== "CANCELLED" ||
      originalJ1.holdReason !== `SUPERSEDED_BY_TEST_J1_RECONCILIATION:${existingJ1.id}`
    ) {
      throw new ZohoAdminValidationError("The prior TEST J1 reconciliation is incomplete or inconsistent.", 409);
    }
    return { changed: false, contactEvent: existingContact, journeyEvent: existingJ1 } as const;
  }

  if (
    !originalContact ||
    originalContact.onboardingPlanId !== plan.id ||
    originalContact.recipientEmailNormalized !== owner.normalizedEmail ||
    originalContact.eventType !== "UPSERT_CONTACT" ||
    originalContact.status !== "SUCCEEDED" ||
    !isDefinitiveContactProviderOutcome(originalContact.lastProviderOutcome) ||
    eventReason(originalContact.payload) !== TEST_J1_ORIGINAL_EVENT_REASON
  ) {
    throw new ZohoAdminValidationError("The original contact event is not a definitive successful TEST J1 event.", 409);
  }
  if (
    !originalJ1 ||
    originalJ1.onboardingPlanId !== plan.id ||
    originalJ1.recipientEmailNormalized !== owner.normalizedEmail ||
    originalJ1.eventType !== "TRIGGER_JOURNEY" ||
    originalJ1.journey !== "J1" ||
    originalJ1.status !== "HELD" ||
    originalJ1.attemptCount !== 0 ||
    originalJ1.processingClaimId ||
    originalJ1.lastProviderOutcome ||
    eventReason(originalJ1.payload) !== TEST_J1_ORIGINAL_EVENT_REASON
  ) {
    throw new ZohoAdminValidationError("The original held J1 event is no longer safe to supersede.", 409);
  }
  const conflicting = await transaction.zohoOutboxEvent.findFirst({
    where: {
      onboardingPlanId: plan.id,
      recipientEmailNormalized: owner.normalizedEmail,
      status: { in: ["PENDING", "HELD", "PROCESSING", "RETRY"] },
      id: { not: originalJ1.id }
    },
    select: { id: true }
  });
  if (conflicting) throw new ZohoAdminValidationError("Another unresolved event conflicts with TEST J1 reconciliation.", 409);

  const { snapshot } = await getPersistedZohoContactSnapshotWithClient(transaction, plan.planId, owner.id);
  const baseMetadata = {
    originalContactEventId: originalContact.id,
    originalJ1EventId: originalJ1.id,
    reconciliationId: keys.reconciliationId
  };
  const contactResult = await createZohoContactSyncEventInTransaction(transaction, {
    eventKey: keys.contactEventKey,
    onboardingPlanId: plan.id,
    payload: {
      schemaVersion: 2,
      event: {
        ...baseMetadata,
        occurrenceKey: keys.occurrenceKey,
        reason: TEST_J1_RECONCILIATION_EVENT_REASON,
        taskKey: currentTask.templateKey
      },
      revalidateBeforeDispatch: true,
      snapshot
    },
    recipientEmail: owner.email,
    status: "PENDING",
    taskKey: currentTask.templateKey
  });
  if (!contactResult.event) throw new ZohoAdminValidationError("The reconciliation contact event was blocked.", 409);

  const journeyResult = await createZohoJourneyTriggerEventInTransaction(transaction, {
    dedupeKey: keys.journeyDedupeKey,
    eventKey: keys.journeyEventKey,
    handoffKey: keys.reconciliationId,
    holdReason: TEST_J1_RECONCILIATION_HOLD_REASON,
    journey: "J1",
    onboardingPlanId: plan.id,
    payload: {
      schemaVersion: 2,
      event: {
        ...baseMetadata,
        dependsOnContactEventId: contactResult.event.id,
        occurrenceKey: keys.occurrenceKey,
        reason: TEST_J1_RECONCILIATION_EVENT_REASON,
        taskKey: currentTask.templateKey,
        testJ1KeyFingerprint: testJ1.j1KeyFingerprint ?? "",
        testJ1SelectionMode: testJ1.j1SelectionMode
      },
      revalidateBeforeDispatch: true,
      snapshot
    },
    recipientEmail: owner.email,
    status: "HELD",
    taskKey: currentTask.templateKey
  });
  if (!journeyResult.event) throw new ZohoAdminValidationError("The replacement J1 event was blocked.", 409);

  const superseded = await transaction.zohoOutboxEvent.updateMany({
    where: {
      attemptCount: 0,
      id: originalJ1.id,
      lastProviderOutcome: null,
      processingClaimId: null,
      status: "HELD"
    },
    data: {
      holdReason: `SUPERSEDED_BY_TEST_J1_RECONCILIATION:${journeyResult.event.id}`,
      nextAttemptAt: null,
      status: "CANCELLED"
    }
  });
  if (superseded.count !== 1) throw new ZohoAdminValidationError("The original J1 event changed during reconciliation.", 409);

  await createZohoAutomationAuditInTransaction(transaction, {
    action: TEST_J1_RECONCILIATION_AUDIT_ACTION,
    actor: input.actor,
    evidenceReference: keys.reconciliationId,
    onboardingPlanId: plan.id,
    reason: `Prepared replacement contact ${contactResult.event.id} and held J1 ${journeyResult.event.id}; superseded original held J1 ${originalJ1.id}. No provider request was made.`,
    recipientEmail: owner.email
  });
  return { changed: true, contactEvent: contactResult.event, journeyEvent: journeyResult.event } as const;
}

export async function prepareTestJ1SnapshotReconciliation(input: {
  actor: string;
  confirmation: string;
  planId: string;
}) {
  if (input.confirmation !== TEST_J1_RECONCILIATION_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact TEST J1 reconciliation confirmation phrase.");
  }
  const config = getZohoTestJ1ReconciliationConfiguration();
  assertDormantReconciliationConfiguration(config);
  return prisma.$transaction(
    (transaction) => reconcileTestJ1SnapshotInTransaction(transaction, input, config),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
