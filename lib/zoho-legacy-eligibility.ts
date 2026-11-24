import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

type EligibilityClient = Prisma.TransactionClient | PrismaClient;

export const LEGACY_AUTOMATION_BLOCK_REASON = "LEGACY_PLAN_AUTOMATION_PROTECTED";

export function classifyLegacyAutomationEligibility(input: {
  legacyRecordPresent: boolean | null;
  planFound: boolean;
}) {
  if (!input.planFound || input.legacyRecordPresent === null) {
    return { allowed: false, reason: "AUTOMATION_ELIGIBILITY_UNKNOWN" } as const;
  }
  if (input.legacyRecordPresent) {
    return { allowed: false, reason: LEGACY_AUTOMATION_BLOCK_REASON } as const;
  }
  return { allowed: true, reason: null } as const;
}

export async function getZohoPlanAutomationEligibility(
  client: EligibilityClient,
  onboardingPlanId: string
) {
  const plan = await client.onboardingPlan.findUnique({
    where: { id: onboardingPlanId },
    select: {
      id: true,
      planId: true,
      zohoLegacyAutomationProtection: { select: { onboardingPlanId: true } }
    }
  });
  const decision = classifyLegacyAutomationEligibility({
    legacyRecordPresent: plan ? Boolean(plan.zohoLegacyAutomationProtection) : null,
    planFound: Boolean(plan)
  });
  return { ...decision, planId: plan?.planId ?? null };
}

export async function assertZohoPlanAutomationEligible(
  client: EligibilityClient,
  onboardingPlanId: string
) {
  const decision = await getZohoPlanAutomationEligibility(client, onboardingPlanId);
  if (!decision.allowed) {
    throw new ZohoAdminValidationError(
      decision.reason === LEGACY_AUTOMATION_BLOCK_REASON
        ? "This legacy MSP plan is permanently protected from Zoho automation."
        : "Zoho automation eligibility could not be established.",
      409
    );
  }
  return decision;
}

export async function assertRecipientHasNoLegacyAutomationPlan(
  client: EligibilityClient,
  normalizedEmail: string
) {
  const legacyContact = await client.planContact.findFirst({
    where: {
      normalizedEmail,
      onboardingPlan: { zohoLegacyAutomationProtection: { isNot: null } }
    },
    select: { id: true }
  });
  if (legacyContact) {
    throw new ZohoAdminValidationError(
      "This recipient belongs to a legacy MSP cohort and cannot be used by a direct Zoho write path.",
      409
    );
  }
}
