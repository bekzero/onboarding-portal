import type { Prisma, ZohoJourneyType } from "@prisma/client";

const APPROVED_TARGET = {
  planId: "kzeroautomatione2etest-nfr",
  email: "beneakinkzero@gmail.com"
} as const;

function value(name: string) {
  return process.env[name]?.trim() || "";
}

export function getZohoProductionRolloutConfiguration() {
  const allowedPlanIds = new Set(
    value("ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS")
      .split(",")
      .map((planId) => planId.trim())
      .filter(Boolean)
  );
  const enabledJourneys = new Set<ZohoJourneyType>(
    value("ZMA_AUTOMATED_JOURNEYS").toUpperCase() === "J1" ? ["J1"] : []
  );
  const target = allowedPlanIds.size === 1 &&
    allowedPlanIds.has(APPROVED_TARGET.planId) &&
    value("ZOHO_PRODUCTION_ROLLOUT_EMAIL").toLowerCase() === APPROVED_TARGET.email
    ? APPROVED_TARGET
    : null;
  return { target, enabledJourneys } as const;
}

export function isZohoProductionRolloutRecipientAllowed(input: {
  planId: string;
  primaryEmail: string;
  ownerEmail: string;
  recipientEmail: string;
}) {
  const { target } = getZohoProductionRolloutConfiguration();
  return Boolean(target && input.planId === target.planId &&
    [input.primaryEmail, input.ownerEmail, input.recipientEmail]
      .every((email) => email.trim().toLowerCase() === target.email));
}

export async function getApprovedZohoRolloutOwner(
  client: Pick<Prisma.TransactionClient, "onboardingPlan">,
  input: { onboardingPlanId: string; planId: string; recipientEmail: string }
) {
  const { target } = getZohoProductionRolloutConfiguration();
  if (!target || input.planId !== target.planId || input.recipientEmail.trim().toLowerCase() !== target.email) return null;
  const plan = await client.onboardingPlan.findUnique({
    where: { id: input.onboardingPlanId },
    select: {
      planId: true,
      msp: { select: { primaryContactEmail: true } },
      zohoLegacyAutomationProtection: { select: { onboardingPlanId: true } },
      zohoAutomationAudits: {
        where: { action: { in: ["email_automation.enabled", "email_automation.disabled"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { action: true, actor: true, evidenceReference: true, recipientEmailNormalized: true }
      },
      planContacts: {
        where: { role: "ONBOARDING_OWNER" },
        take: 2,
        select: { id: true, email: true, normalizedEmail: true, automationEnabled: true, subscriptionStatus: true }
      }
    }
  });
  const owner = plan?.planContacts[0];
  const approval = plan?.zohoAutomationAudits[0];
  if (!plan || plan.zohoLegacyAutomationProtection || plan.planContacts.length !== 1 || !owner ||
      approval?.action !== "email_automation.enabled" || !approval.actor.startsWith("oidc:") ||
      approval.evidenceReference !== owner.id || approval.recipientEmailNormalized !== target.email ||
      !owner.automationEnabled || owner.subscriptionStatus !== "CONFIRMED" ||
      owner.normalizedEmail !== target.email || !isZohoProductionRolloutRecipientAllowed({
        planId: plan.planId, primaryEmail: plan.msp.primaryContactEmail, ownerEmail: owner.email,
        recipientEmail: input.recipientEmail
      })) return null;
  return owner.id;
}

export function getZohoRolloutEventOwnerId(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return typeof payload.rolloutOwnerId === "string" ? payload.rolloutOwnerId : null;
}

export function isZohoProductionJourneyEnabled(journey: ZohoJourneyType) {
  return getZohoProductionRolloutConfiguration().enabledJourneys.has(journey);
}

export function isZohoProductionRuntime() {
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production";
}
