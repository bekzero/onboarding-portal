import "server-only";

import { prisma } from "@/lib/prisma";
import { getZohoTestConfiguration } from "@/lib/zoho-config";
import { getPersistedZohoContactSnapshotWithClient } from "@/lib/zoho-contact-snapshot";
import { createZohoAutomationAuditInTransaction } from "@/lib/zoho-foundation";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

const CONFIRMATION = "ACTIVATE ISOLATED ZOHO TEST PLAN";

function fixtureEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ZOHO_TEST_FIXTURE_ENABLED?.trim().toLowerCase() === "true" &&
    process.env.ZOHO_TEST_DATABASE_CONFIRMED?.trim().toLowerCase() === "true"
  );
}

export async function activateIsolatedZohoTestPlan(input: {
  actor: string;
  confirmation: unknown;
  contactId: string;
  planId: string;
}) {
  if (!fixtureEnabled()) {
    throw new ZohoAdminValidationError(
      "The isolated Zoho test fixture is disabled or this is a production environment.",
      403
    );
  }
  if (input.confirmation !== CONFIRMATION) {
    throw new ZohoAdminValidationError(`Type ${CONFIRMATION} to confirm this test-only action.`);
  }
  const testConfig = getZohoTestConfiguration();
  if (!testConfig.allowedPlanIds.has(input.planId)) {
    throw new ZohoAdminValidationError("The selected plan is not on the test plan allowlist.", 403);
  }

  return prisma.$transaction(async (transaction) => {
    const plan = await transaction.onboardingPlan.findUnique({
      where: { planId: input.planId },
      include: { planContacts: { where: { id: input.contactId } } }
    });
    if (!plan) throw new ZohoAdminValidationError("Onboarding plan not found.", 404);
    if (plan.automationOrigin !== "NATIVE") {
      throw new ZohoAdminValidationError("Legacy plans cannot be activated by the test fixture.", 409);
    }
    const contact = plan.planContacts[0];
    if (!contact || contact.role !== "ONBOARDING_OWNER" || !contact.automationEnabled) {
      throw new ZohoAdminValidationError(
        "Select an automation-enabled Onboarding Owner on the test plan.",
        409
      );
    }
    if (!testConfig.allowedEmails.has(contact.normalizedEmail)) {
      throw new ZohoAdminValidationError("The selected contact is not on the internal email allowlist.", 403);
    }

    await getPersistedZohoContactSnapshotWithClient(transaction, plan.planId, contact.id);

    const competingPlan = await transaction.planContact.findFirst({
      where: {
        automationEnabled: true,
        normalizedEmail: contact.normalizedEmail,
        onboardingPlan: {
          automationEnrollmentState: "ACTIVE",
          id: { not: plan.id }
        }
      },
      select: { onboardingPlan: { select: { planId: true } } }
    });
    if (competingPlan) {
      throw new ZohoAdminValidationError(
        `The recipient already belongs to active plan ${competingPlan.onboardingPlan.planId}.`,
        409
      );
    }

    const context = await transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: contact.normalizedEmail }
    });
    if (
      context &&
      (context.state === "BLOCKED" ||
        context.state === "RELEASE_PENDING" ||
        (context.activePlanId && context.activePlanId !== plan.id))
    ) {
      throw new ZohoAdminValidationError(
        "The recipient communication context is not safely assignable to this test plan.",
        409
      );
    }

    const activatedAt = new Date();
    await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: {
        automationEnrolledAt: activatedAt,
        automationEnrolledBy: input.actor,
        automationEnrollmentState: "ACTIVE"
      }
    });
    await transaction.zohoCommunicationContext.upsert({
      where: { recipientEmailNormalized: contact.normalizedEmail },
      create: {
        acquiredAt: activatedAt,
        acquiredBy: input.actor,
        acquisitionReason: "Approved isolated Phase 3 test fixture.",
        activePlanId: plan.id,
        recipientEmailNormalized: contact.normalizedEmail,
        state: "ACTIVE"
      },
      update: {
        acquiredAt: activatedAt,
        acquiredBy: input.actor,
        acquisitionReason: "Approved isolated Phase 3 test fixture.",
        activePlanId: plan.id,
        state: "ACTIVE",
        version: { increment: 1 }
      }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "test_fixture.activated",
      actor: input.actor,
      evidenceReference: "ZOHO_TEST_DATABASE_CONFIRMED",
      onboardingPlanId: plan.id,
      reason: "Activated a native allowlisted plan and assigned its context in an isolated test database.",
      recipientEmail: contact.email
    });

    return {
      activatedAt: activatedAt.toISOString(),
      contextState: "ACTIVE" as const,
      planId: plan.planId,
      recipientEmail: contact.normalizedEmail
    };
  });
}

export const ZOHO_TEST_FIXTURE_CONFIRMATION = CONFIRMATION;
