import "server-only";
import { createHash } from "node:crypto";
import type { SubscriptionEligibilityStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getZohoApiClient } from "@/lib/zoho-api";
import {
  classifyZohoListMembership,
  type ZohoJourney,
  type ZohoLeadField,
  type ZohoSubscribeResult
} from "@/lib/zoho-api-core";
import { getPersistedZohoContactSnapshot } from "@/lib/zoho-contact-snapshot";
import {
  getZohoConfigurationStatus,
  getZohoJourneyConfiguration,
  getZohoListKey,
  getZohoTestConfiguration,
  getZohoTopicId
} from "@/lib/zoho-config";
import {
  buildZohoFieldDiscoveryReport,
  buildZohoLeadInfo,
  getZohoFieldIdentifierMap
} from "@/lib/zoho-field-mapping";
import { normalizeZohoRecipientEmail } from "@/lib/zoho-foundation";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";
import { evaluateZohoTestPolicy } from "@/lib/zoho-test-policy";

const JOURNEY_NAMES = {
  J1: "ONB J1 Welcome and Kickoff Booking",
  J3_R1: "ONB J3-R1 Next Action Nudge",
  J5: "ONB J5 Your Next Step Is Ready",
  J8: "ONB J8 Completion and Expansion"
} as const;

async function recordAudit(input: {
  action: string;
  actor: string;
  evidenceReference?: string;
  onboardingPlanId?: string;
  planId?: string;
  reason: string;
  recipientEmail?: string;
}) {
  return prisma.zohoAutomationAudit.create({
    data: {
      action: input.action,
      actor: input.actor,
      evidenceReference: input.evidenceReference ?? null,
      onboardingPlanId: input.onboardingPlanId,
      planId: input.planId,
      reason: input.reason,
      recipientEmailNormalized: input.recipientEmail
        ? normalizeZohoRecipientEmail(input.recipientEmail)
        : null
    }
  });
}

export async function getZohoPhase2Status(planId?: string) {
  const [lastFieldDiscovery, lastJourneyDiscovery, lastTest] = await Promise.all([
    prisma.zohoAutomationAudit.findFirst({
      where: { action: "zoho.fields.discovered" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, reason: true }
    }),
    prisma.zohoAutomationAudit.findFirst({
      where: { action: "zoho.journeys.discovered" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, reason: true }
    }),
    prisma.zohoAutomationAudit.findFirst({
      where: {
        action: { in: ["zoho.test_sync.accepted", "zoho.test_sync.failed"] },
        ...(planId ? { planId } : {})
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, createdAt: true, reason: true }
    })
  ]);

  return {
    configuration: getZohoConfigurationStatus(),
    lastFieldDiscovery,
    lastJourneyDiscovery,
    lastTestResult: lastTest
  };
}

export async function discoverZohoFields(actor: string) {
  const fields = await getZohoApiClient().getAllLeadFields();
  const report = buildZohoFieldDiscoveryReport(fields);
  const found = report.filter((entry) => entry.zohoIdentifier).length;
  const identifierMap = getZohoFieldIdentifierMap(fields);
  await recordAudit({
    action: "zoho.fields.discovered",
    actor,
    evidenceReference: `fields:${found}/${report.length}`,
    reason: `${found} of ${report.length} required custom fields have unique identifiers; controlled write verification remains required.`
  });
  return {
    allRequiredIdentifiersPresent: identifierMap.ready,
    builtInOrCustomMissing: identifierMap.missing,
    controlledWriteVerificationRequired: true,
    report
  };
}

function journeyDiscoveryStatus(
  journey: keyof typeof JOURNEY_NAMES,
  configured: { journeyKey: string; triggerKey: string },
  discovered: ZohoJourney[]
) {
  const byConfiguredKey = configured.journeyKey
    ? discovered.find((item) => item.journeyKey === configured.journeyKey)
    : undefined;
  const byName = discovered.find(
    (item) => item.journeyName.trim().toLowerCase() === JOURNEY_NAMES[journey].toLowerCase()
  );
  const match = byConfiguredKey ?? byName;

  let status: "FOUND" | "MISSING" | "CONFIGURED" | "INACTIVE_OR_UNAVAILABLE" | "UNVERIFIED";
  if (match && configured.journeyKey && configured.triggerKey) {
    status =
      match.journeyKey === configured.journeyKey && match.triggerKey === configured.triggerKey
        ? "CONFIGURED"
        : "UNVERIFIED";
  } else if (match) {
    status = "FOUND";
  } else if (configured.journeyKey || configured.triggerKey) {
    status = "INACTIVE_OR_UNAVAILABLE";
  } else {
    status = "MISSING";
  }

  return {
    configuredJourneyKeyPresent: Boolean(configured.journeyKey),
    configuredTriggerKeyPresent: Boolean(configured.triggerKey),
    discoveredJourneyKey: match?.journeyKey ?? null,
    discoveredName: match?.journeyName ?? null,
    discoveredTriggerKey: match?.triggerKey ?? null,
    journey,
    status
  };
}

export async function discoverZohoJourneys(actor: string) {
  const discovered = await getZohoApiClient().getOpenJourneys();
  const configuration = getZohoJourneyConfiguration();
  const report = (Object.keys(JOURNEY_NAMES) as Array<keyof typeof JOURNEY_NAMES>).map((journey) =>
    journeyDiscoveryStatus(journey, configuration[journey], discovered)
  );
  const configured = report.filter((entry) => entry.status === "CONFIGURED").length;
  await recordAudit({
    action: "zoho.journeys.discovered",
    actor,
    evidenceReference: `journeys:${configured}/${report.length}`,
    reason: `${configured} of ${report.length} journey configurations match an open journey.`
  });
  return { report };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function assertSafeTestTarget(planId: string, contactId: string) {
  const testConfig = getZohoTestConfiguration();
  const persisted = await getPersistedZohoContactSnapshot(planId, contactId);
  const context = await prisma.zohoCommunicationContext.findUnique({
    where: { recipientEmailNormalized: persisted.contact.normalizedEmail }
  });
  const conflictingPlans = await prisma.planContact.findMany({
    where: {
      automationEnabled: true,
      normalizedEmail: persisted.contact.normalizedEmail,
      onboardingPlanId: { not: persisted.plan.id },
      onboardingPlan: { automationEnrollmentState: "ACTIVE" }
    },
    select: { onboardingPlan: { select: { planId: true } } }
  });
  const competingActivePlanIds = conflictingPlans.map((item) => item.onboardingPlan.planId);
  const policy = evaluateZohoTestPolicy({
    competingActivePlanIds,
    contactAutomationEnabled: persisted.contact.automationEnabled,
    contextOwnedByPlan: context?.activePlanId === persisted.plan.id,
    contextState: context?.state ?? null,
    emailAllowlisted: testConfig.allowedEmails.has(persisted.contact.normalizedEmail),
    planAllowlisted: testConfig.allowedPlanIds.has(planId),
    planAutomationState: persisted.plan.automationEnrollmentState,
    subscriptionStatus: persisted.contact.subscriptionStatus,
    testModeEnabled: testConfig.enabled
  });
  if (!policy.allowed) {
    const messages = {
      CONTACT_NOT_ELIGIBLE: "The selected contact is not eligible for automation.",
      CONTEXT_NOT_ACTIVE: "The test contact needs an active communication context owned by this test plan.",
      EMAIL_NOT_ALLOWLISTED: "This contact email is not on the internal Zoho test allowlist.",
      MULTIPLE_ACTIVE_PLANS: `Another automation-active plan references this recipient: ${competingActivePlanIds.join(", ")}.`,
      PLAN_NOT_ACTIVE: "The test plan must be explicitly automation-active.",
      PLAN_NOT_ALLOWLISTED: "This plan is not allowlisted for Zoho test synchronization.",
      SUBSCRIPTION_BLOCKED: "The contact's subscription state blocks test synchronization.",
      TEST_MODE_DISABLED: "Zoho test synchronization is disabled."
    };
    throw new ZohoAdminValidationError(messages[policy.reason], policy.reason.includes("ALLOWLIST") || policy.reason === "TEST_MODE_DISABLED" ? 403 : 409);
  }

  return persisted;
}

async function prepareTestSync(planId: string, contactId: string) {
  const persisted = await assertSafeTestTarget(planId, contactId);
  const fields = await getZohoApiClient().getAllLeadFields();
  let leadInfo;
  try {
    leadInfo = buildZohoLeadInfo(persisted.snapshot, fields);
  } catch (error) {
    throw new ZohoAdminValidationError(
      error instanceof Error ? error.message : "Zoho field mapping is incomplete.",
      409
    );
  }
  const listKey = getZohoListKey();
  const topicId = getZohoTopicId();
  if (!listKey || !topicId) {
    throw new ZohoAdminValidationError("Zoho list and topic configuration are required.", 503);
  }
  return {
    fields,
    leadInfo,
    listKey,
    persisted,
    previewFingerprint: fingerprint({ leadInfo, listKey, planId, topicId }),
    topicId
  };
}

export async function previewZohoTestSync(planId: string, contactId: string) {
  const prepared = await prepareTestSync(planId, contactId);
  return {
    fieldCount: Object.keys(prepared.leadInfo).length,
    fieldDiscovery: buildZohoFieldDiscoveryReport(prepared.fields),
    planId,
    previewFingerprint: prepared.previewFingerprint,
    recipient: prepared.persisted.contact.normalizedEmail,
    snapshot: prepared.persisted.snapshot,
    warnings: [
      "This is an allowlisted test contact only.",
      "A write may send a Zoho double-opt-in confirmation email.",
      "A successful upsert does not confirm topic eligibility, Marketing status, or delivery."
    ]
  };
}

export async function performZohoTestSync(input: {
  actor: string;
  confirmation: unknown;
  contactId: string;
  planId: string;
  previewFingerprint: unknown;
}) {
  if (input.confirmation !== "UPSERT ALLOWLISTED TEST CONTACT") {
    throw new ZohoAdminValidationError("Explicit test-contact confirmation is required.");
  }
  const prepared = await prepareTestSync(input.planId, input.contactId);
  if (input.previewFingerprint !== prepared.previewFingerprint) {
    throw new ZohoAdminValidationError("The test preview has changed. Generate and review a new preview.", 409);
  }

  let result: ZohoSubscribeResult;
  try {
    result = await getZohoApiClient().subscribeLead({
      leadInfo: prepared.leadInfo,
      listKey: prepared.listKey,
      topicId: prepared.topicId
    });
  } catch (error) {
    await recordAudit({
      action: "zoho.test_sync.failed",
      actor: input.actor,
      evidenceReference: "listsubscribe:failed",
      onboardingPlanId: prepared.persisted.plan.id,
      planId: prepared.persisted.plan.planId,
      reason: "The approved test synchronization failed; see the sanitized API response.",
      recipientEmail: prepared.persisted.contact.normalizedEmail
    });
    throw error;
  }

  const subscriptionStatus: SubscriptionEligibilityStatus =
    result.classification === "PENDING_CONFIRMATION" ? "PENDING_CONFIRMATION" : "MANUAL_REVIEW";
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.planContact.update({
        where: { id: input.contactId },
        data: {
          subscriptionEvidenceReference: `listsubscribe:${result.code}`,
          subscriptionStatus,
          subscriptionVerificationSource: "ZMA listsubscribe test",
          subscriptionVerifiedAt: new Date(),
          subscriptionVerifiedBy: input.actor
        }
      });
      await transaction.zohoAutomationAudit.create({
        data: {
          action: "zoho.test_sync.accepted",
          actor: input.actor,
          evidenceReference: `listsubscribe:${result.code}`,
          onboardingPlanId: prepared.persisted.plan.id,
          planId: prepared.persisted.plan.planId,
          reason: `${result.classification}: request accepted; delivery and full eligibility remain unconfirmed.`,
          recipientEmailNormalized: prepared.persisted.contact.normalizedEmail
        }
      });
    });

  } catch {
    throw new ZohoAdminValidationError(
      "Zoho accepted the test request, but the local result could not be recorded. Treat the outcome as uncertain and verify the contact manually in Zoho.",
      502
    );
  }

  return {
    classification: result.classification,
    code: result.code,
    message: result.message,
    subscriptionStatus
  };
}

export async function checkZohoListMembership(email: string) {
  const normalizedEmail = normalizeZohoRecipientEmail(email);
  const listKey = getZohoListKey();
  if (!listKey) throw new ZohoAdminValidationError("Zoho list configuration is missing.", 503);
  const client = getZohoApiClient();
  const found: Array<"active" | "unsub" | "bounce"> = [];
  let truncated = false;

  for (const status of ["active", "unsub", "bounce"] as const) {
    for (let page = 0; page < 5; page += 1) {
      const leads = await client.getListLeads({
        fromIndex: page * 200 + 1,
        listKey,
        range: 200,
        status
      });
      if (leads.some((lead) => normalizeZohoRecipientEmail(lead.email) === normalizedEmail)) {
        found.push(status);
        break;
      }
      if (leads.length < 200) break;
      if (page === 4) truncated = true;
    }
  }

  const recommendedStatus: SubscriptionEligibilityStatus = classifyZohoListMembership(found, truncated);
  return {
    listStatuses: found,
    normalizedEmail,
    recommendedStatus,
    requiresManualTopicAndMarketingVerification: true,
    truncated
  };
}

export async function verifyPlanContactSubscription(input: {
  actor: string;
  contactId: string;
  evidenceReference: unknown;
  planId: string;
  reason: unknown;
  status: unknown;
}) {
  const allowedStatuses = new Set<SubscriptionEligibilityStatus>([
    "CONFIRMED",
    "INELIGIBLE",
    "MANUAL_REVIEW"
  ]);
  if (typeof input.status !== "string" || !allowedStatuses.has(input.status as SubscriptionEligibilityStatus)) {
    throw new ZohoAdminValidationError("Select a valid manually verified subscription status.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const evidenceReference =
    typeof input.evidenceReference === "string" ? input.evidenceReference.trim() : "";
  if (!reason || !evidenceReference) {
    throw new ZohoAdminValidationError("A verification reason and Zoho evidence reference are required.");
  }

  return prisma.$transaction(async (transaction) => {
    const contact = await transaction.planContact.findFirst({
      where: { id: input.contactId, onboardingPlan: { planId: input.planId } },
      select: { email: true, id: true, onboardingPlanId: true }
    });
    if (!contact) throw new ZohoAdminValidationError("Plan contact not found.", 404);
    const updated = await transaction.planContact.update({
      where: { id: contact.id },
      data: {
        subscriptionEvidenceReference: evidenceReference,
        subscriptionStatus: input.status as SubscriptionEligibilityStatus,
        subscriptionVerificationSource: "Manual ZMA verification",
        subscriptionVerifiedAt: new Date(),
        subscriptionVerifiedBy: input.actor
      }
    });
    await transaction.zohoAutomationAudit.create({
      data: {
        action: "subscription.manually_verified",
        actor: input.actor,
        evidenceReference,
        onboardingPlanId: contact.onboardingPlanId,
        planId: input.planId,
        reason,
        recipientEmailNormalized: normalizeZohoRecipientEmail(contact.email)
      }
    });
    return updated;
  });
}

export type { ZohoLeadField };
