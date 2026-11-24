import "server-only";

import { getZohoConfigurationStatus, getZohoDispatchConfiguration, getZohoMspEnrollmentPilotConfiguration, getZohoMspEnrollmentSyncConfiguration } from "@/lib/zoho-config";
import { getPersistedZohoContactSnapshotWithClient } from "@/lib/zoho-contact-snapshot";
import { evaluateFullFieldTestIntentReadiness } from "@/lib/zoho-existing-plan-test-intent-core";
import {
  createStableZohoKey,
  createZohoAutomationAuditInTransaction,
  createZohoContactSyncEventInTransaction,
  isZohoEventEmissionEnabled
} from "@/lib/zoho-foundation";
import {
  DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION,
  getIndividuallyRecordedPermission,
  getPersistedListPrivacyVerification,
  getPilotDownstreamAutomationVerification,
  getPilotSubscriptionConfirmation,
  loadConfiguredPilotPlan
} from "@/lib/zoho-pilot-admin";
import { checkZohoListMembership } from "@/lib/zoho-phase2";
import { prisma } from "@/lib/prisma";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";
import { assertZohoPlanAutomationEligible } from "@/lib/zoho-legacy-eligibility";

export const FULL_FIELD_TEST_INTENT_CONFIRMATION = "PREPARE ONE FULL-FIELD ZOHO TEST INTENT";
export const FULL_FIELD_TEST_INTENT_AUDIT_ACTION = "test_j1.existing_plan_contact_intent_prepared";

export function getFullFieldTestIntentKey(planId: string, email: string) {
  return createStableZohoKey("contact-sync", "existing-plan-full-field-test", planId, email);
}

export async function getExistingFullFieldTestIntent(planId: string) {
  const pilot = getZohoMspEnrollmentPilotConfiguration();
  if (!pilot.configured || pilot.planId !== planId) return null;
  return prisma.zohoOutboxEvent.findUnique({
    where: { eventKey: getFullFieldTestIntentKey(planId, pilot.email) },
    select: {
      attemptCount: true,
      createdAt: true,
      holdReason: true,
      id: true,
      lastProviderOutcome: true,
      status: true,
      updatedAt: true
    }
  });
}

export async function prepareExistingFullFieldTestIntent(input: {
  actor: string;
  confirmation: string;
  planId: string;
}) {
  if (input.confirmation !== FULL_FIELD_TEST_INTENT_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact full-field test-intent confirmation phrase.");
  }

  const loaded = await loadConfiguredPilotPlan(input.planId);
  await assertZohoPlanAutomationEligible(prisma, loaded.plan.id);
  const existingIntent = await getExistingFullFieldTestIntent(input.planId);
  if (existingIntent) {
    return {
      created: false,
      event: {
        attemptCount: existingIntent.attemptCount,
        createdAt: existingIntent.createdAt,
        id: existingIntent.id,
        status: existingIntent.status
      }
    };
  }
  const [permission, context, listPrivacy, downstream, subscriptionEvidence, membership] = await Promise.all([
    getIndividuallyRecordedPermission(loaded.plan.id, loaded.owner.normalizedEmail),
    prisma.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail },
      select: { activePlanId: true, state: true }
    }),
    getPersistedListPrivacyVerification(),
    getPilotDownstreamAutomationVerification(loaded.plan.id, loaded.owner.normalizedEmail),
    getPilotSubscriptionConfirmation(loaded.plan.id, loaded.owner.normalizedEmail),
    checkZohoListMembership(loaded.owner.email)
  ]);
  const dispatch = getZohoDispatchConfiguration();
  const configuration = getZohoConfigurationStatus();
  const pilot = getZohoMspEnrollmentPilotConfiguration();
  const readiness = evaluateFullFieldTestIntentReadiness({
    automaticDispatchEnabled: dispatch.automaticDispatchEnabled,
    contactAutomationEnabled: loaded.owner.automationEnabled,
    contactSyncEnabled: dispatch.contactSyncEnabled,
    contextOwnedByPlan: context?.state === "ACTIVE" && context.activePlanId === loaded.plan.id,
    dispatchMode: dispatch.mode,
    downstreamAutomationVerified: downstream?.action === DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION,
    eventEmissionEnabled: isZohoEventEmissionEnabled(),
    globalKillSwitch: dispatch.globalKillSwitch,
    journeyTriggeringEnabled: dispatch.journeyTriggeringEnabled,
    listPrivacyVerified: configuration.listPrivacyVerified || Boolean(listPrivacy),
    membershipComplete: !membership.truncated,
    membershipStatuses: membership.listStatuses,
    nudgeEvaluationEnabled: configuration.nudgeEvaluationEnabled,
    permissionEvidenceRecorded: Boolean(permission?.evidenceReference),
    pilotTargetMatches: pilot.configured && pilot.planId === loaded.plan.planId && pilot.email === loaded.owner.normalizedEmail,
    planAutomationActive: loaded.plan.automationEnrollmentState === "ACTIVE",
    productionDispatchApproved: dispatch.productionApproved,
    singleContactPilotEnabled: configuration.singleContactPilotEnabled,
    subscriptionEvidenceRecorded: Boolean(subscriptionEvidence?.evidenceReference),
    subscriptionStatus: loaded.owner.subscriptionStatus,
    syncOnEnrollmentEnabled: getZohoMspEnrollmentSyncConfiguration().enabled,
    testContactSyncEnabled: configuration.testContactSync.enabled,
    testModeEnabled: configuration.testMode.enabled
  });
  if (!readiness.allowed) {
    throw new ZohoAdminValidationError(`The full-field test intent is blocked: ${readiness.blockers.join(", ")}.`, 409);
  }

  const eventKey = getFullFieldTestIntentKey(loaded.plan.planId, loaded.owner.normalizedEmail);
  return prisma.$transaction(async (transaction) => {
    const [currentPlan, currentContext, currentPermission, currentSubscription, currentDownstream, existingUnresolved] = await Promise.all([
      transaction.onboardingPlan.findUnique({
        where: { id: loaded.plan.id },
        select: {
          automationEnrollmentState: true,
          msp: { select: { primaryContactEmail: true } },
          planContacts: {
            where: { normalizedEmail: loaded.owner.normalizedEmail, role: "ONBOARDING_OWNER" },
            take: 1,
            select: { automationEnabled: true, id: true, subscriptionStatus: true }
          }
        }
      }),
      transaction.zohoCommunicationContext.findUnique({ where: { recipientEmailNormalized: loaded.owner.normalizedEmail } }),
      transaction.zohoAutomationAudit.findFirst({
        where: { action: "msp_enrollment.contact_permission_recorded", actor: { startsWith: "oidc:" }, evidenceReference: { not: null }, onboardingPlanId: loaded.plan.id, recipientEmailNormalized: loaded.owner.normalizedEmail }
      }),
      transaction.zohoAutomationAudit.findFirst({
        where: { action: "msp_pilot.subscription_confirmed", actor: { startsWith: "oidc:" }, evidenceReference: { not: null }, onboardingPlanId: loaded.plan.id, recipientEmailNormalized: loaded.owner.normalizedEmail }
      }),
      transaction.zohoAutomationAudit.findFirst({
        where: { action: { in: ["msp_pilot.downstream_automation_review_passed", "msp_pilot.downstream_automation_review_blocked"] }, actor: { startsWith: "oidc:" }, onboardingPlanId: loaded.plan.id, recipientEmailNormalized: loaded.owner.normalizedEmail },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      transaction.zohoOutboxEvent.findFirst({
        where: { eventKey: { not: eventKey }, eventType: "UPSERT_CONTACT", onboardingPlanId: loaded.plan.id, recipientEmailNormalized: loaded.owner.normalizedEmail, status: { in: ["PENDING", "PROCESSING", "HELD", "RETRY"] } },
        select: { id: true }
      })
    ]);
    const owner = currentPlan?.planContacts[0];
    if (
      currentPlan?.automationEnrollmentState !== "ACTIVE" ||
      !owner?.automationEnabled ||
      owner.subscriptionStatus === "INELIGIBLE" ||
      currentPlan.msp.primaryContactEmail.trim().toLowerCase() !== loaded.owner.normalizedEmail ||
      currentContext?.state !== "ACTIVE" ||
      currentContext.activePlanId !== loaded.plan.id ||
      !currentPermission ||
      !currentSubscription ||
      currentDownstream?.action !== DOWNSTREAM_AUTOMATION_REVIEW_PASSED_ACTION
    ) throw new ZohoAdminValidationError("The plan, recipient, permission, or readiness evidence changed. Run the preview again.", 409);
    if (existingUnresolved) {
      throw new ZohoAdminValidationError("Another unresolved contact synchronization event already exists for this plan and recipient.", 409);
    }

    const snapshot = await getPersistedZohoContactSnapshotWithClient(transaction, loaded.plan.planId, owner.id);
    const result = await createZohoContactSyncEventInTransaction(transaction, {
      eventKey,
      onboardingPlanId: loaded.plan.id,
      payload: {
        schemaVersion: 3,
        event: { occurrenceKey: `existing-plan-full-field-test:${loaded.plan.planId}`, reason: "existing_plan.full_field_test" },
        revalidateBeforeDispatch: true,
        snapshot: snapshot.snapshot,
        syncMode: "FULL_FIELD"
      },
      recipientEmail: loaded.owner.email,
      status: "PENDING"
    });
    if (result.created) {
      await createZohoAutomationAuditInTransaction(transaction, {
        action: FULL_FIELD_TEST_INTENT_AUDIT_ACTION,
        actor: input.actor,
        evidenceReference: result.event?.id,
        onboardingPlanId: loaded.plan.id,
        reason: "Prepared one allowlisted full-field UPSERT_CONTACT intent from the persisted plan snapshot. No provider request, journey, nudge, or subscription update occurred.",
        recipientEmail: loaded.owner.email
      });
    }
    return {
      created: result.created,
      event: {
        attemptCount: result.event?.attemptCount ?? 0,
        createdAt: result.event?.createdAt ?? null,
        id: result.event?.id ?? null,
        status: result.event?.status ?? null
      }
    };
  });
}
