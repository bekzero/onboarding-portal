import "server-only";

import { Prisma } from "@prisma/client";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoMspEnrollmentSyncConfiguration,
  getZohoTestConfiguration,
  getZohoTestJ1EnrollmentConfiguration
} from "@/lib/zoho-config";
import { createZohoAutomationAuditInTransaction, isZohoEventEmissionEnabled } from "@/lib/zoho-foundation";
import { prisma } from "@/lib/prisma";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

export const RETIRE_CONTEXT_CONFIRMATION = "RETIRE CONTEXT FOR ALLOWLISTED TEST SUCCESSOR";
export const RESTORE_CONTEXT_CONFIRMATION = "RESTORE RETIRED COMMUNICATION CONTEXT";
export const CONTEXT_RETIRED_ACTION = "test_j1.communication_context_retired";
export const CONTEXT_RESTORED_ACTION = "test_j1.communication_context_restored";

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function assertDormantContextAdministration() {
  const dispatch = getZohoDispatchConfiguration();
  const status = getZohoConfigurationStatus();
  if (
    !dispatch.globalKillSwitch ||
    dispatch.mode !== "disabled" ||
    dispatch.contactSyncEnabled ||
    dispatch.exactEventDispatchEnabled ||
    dispatch.automaticDispatchEnabled ||
    dispatch.journeyTriggeringEnabled ||
    dispatch.productionApproved ||
    isZohoEventEmissionEnabled() ||
    getZohoMspEnrollmentSyncConfiguration().enabled ||
    status.nudgeEvaluationEnabled ||
    status.singleContactPilotEnabled ||
    status.testContactSync.enabled ||
    status.testMode.enabled ||
    getZohoTestJ1EnrollmentConfiguration().enabled ||
    enabled("ZOHO_TEST_FIXTURE_ENABLED") ||
    enabled("ZOHO_TEST_DATABASE_CONFIRMED")
  ) {
    throw new ZohoAdminValidationError(
      "Communication-context administration is available only while every Zoho write path is disabled and the global kill switch is enabled.",
      409
    );
  }
}

async function loadRetirementTarget(planId: string, successorPlanId: string) {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    select: {
      automationEnrollmentState: true,
      id: true,
      planContacts: {
        where: { role: "ONBOARDING_OWNER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { automationEnabled: true, email: true, id: true, normalizedEmail: true }
      },
      planId: true
    }
  });
  if (!plan?.planContacts[0]) throw new ZohoAdminValidationError("The current plan and Onboarding Owner were not found.", 404);
  const owner = plan.planContacts[0];
  const test = getZohoTestConfiguration();
  const allowlisted =
    test.allowedPlanIds.size === 1 &&
    test.allowedPlanIds.has(successorPlanId) &&
    test.allowedEmails.size === 1 &&
    test.allowedEmails.has(owner.normalizedEmail);
  if (!allowlisted || successorPlanId === planId) {
    throw new ZohoAdminValidationError("The exact successor plan and recipient must be the sole server-side TEST allowlist target.", 403);
  }
  return { owner, plan, successorPlanId };
}

export async function retireCommunicationContextForTestSuccessor(input: {
  actor: string;
  confirmation: string;
  planId: string;
  reason: string;
  successorPlanId: string;
}) {
  assertDormantContextAdministration();
  if (input.confirmation !== RETIRE_CONTEXT_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact communication-context retirement confirmation phrase.");
  }
  if (input.reason.trim().length < 12) {
    throw new ZohoAdminValidationError("Provide an auditable reason for retiring the current communication context.");
  }
  const loaded = await loadRetirementTarget(input.planId, input.successorPlanId.trim());

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${loaded.owner.normalizedEmail}`}, 0))
    `);
    const [currentPlan, context, successor, unresolved, uncertainJourney, existingRetirement] = await Promise.all([
      transaction.onboardingPlan.findUnique({
        where: { id: loaded.plan.id },
        select: {
          automationEnrollmentState: true,
          planContacts: {
            where: { id: loaded.owner.id, normalizedEmail: loaded.owner.normalizedEmail, role: "ONBOARDING_OWNER" },
            take: 1,
            select: { automationEnabled: true, id: true }
          }
        }
      }),
      transaction.zohoCommunicationContext.findUnique({
        where: { recipientEmailNormalized: loaded.owner.normalizedEmail }
      }),
      transaction.onboardingPlan.findUnique({ where: { planId: loaded.successorPlanId }, select: { id: true } }),
      transaction.zohoOutboxEvent.findFirst({
        where: {
          recipientEmailNormalized: loaded.owner.normalizedEmail,
          status: { in: ["PENDING", "HELD", "PROCESSING", "RETRY"] }
        },
        select: { id: true }
      }),
      transaction.zohoJourneySend.findFirst({
        where: {
          attemptedAt: { not: null },
          providerResult: "UNKNOWN",
          recipientEmailNormalized: loaded.owner.normalizedEmail
        },
        select: { id: true }
      }),
      transaction.zohoAutomationAudit.findFirst({
        where: {
          action: CONTEXT_RETIRED_ACTION,
          onboardingPlanId: loaded.plan.id,
          recipientEmailNormalized: loaded.owner.normalizedEmail,
          evidenceReference: `successor-plan:${loaded.successorPlanId}`
        },
        select: { id: true }
      })
    ]);
    const currentOwner = currentPlan?.planContacts[0];
    if (!currentPlan || !currentOwner) throw new ZohoAdminValidationError("The current plan or Onboarding Owner changed. Re-evaluate before retiring it.", 409);
    if (successor) throw new ZohoAdminValidationError("Retire the old context before creating the successor plan.", 409);
    if (unresolved) throw new ZohoAdminValidationError("Resolve every nonterminal event for this recipient before retiring its context.", 409);
    if (uncertainJourney) throw new ZohoAdminValidationError("Reconcile the recipient's uncertain journey outcome before retiring its context.", 409);
    if (context?.processingClaimId || context?.processingLeaseExpiresAt) {
      throw new ZohoAdminValidationError("The communication context has an active or unresolved processing claim.", 409);
    }
    if (
      context?.state === "UNASSIGNED" &&
      context.activePlanId === null &&
      currentPlan.automationEnrollmentState === "PAUSED" &&
      !currentOwner.automationEnabled &&
      existingRetirement
    ) {
      return { changed: false } as const;
    }
    if (context?.state !== "ACTIVE" || context.activePlanId !== loaded.plan.id) {
      throw new ZohoAdminValidationError("The selected plan does not currently own the active communication context.", 409);
    }
    if (currentPlan.automationEnrollmentState !== "ACTIVE" || !currentOwner.automationEnabled) {
      throw new ZohoAdminValidationError("The selected plan is not the active automation owner. Re-evaluate before retiring it.", 409);
    }

    const now = new Date();
    await transaction.onboardingPlan.update({
      where: { id: loaded.plan.id },
      data: { automationEnrollmentState: "PAUSED" }
    });
    await transaction.planContact.update({ where: { id: currentOwner.id }, data: { automationEnabled: false } });
    await transaction.zohoCommunicationContext.update({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail },
      data: {
        activePlanId: null,
        releaseReason: input.reason.trim(),
        releaseRequestedAt: now,
        releaseRequestedBy: input.actor,
        releasedAt: now,
        releasedBy: input.actor,
        state: "UNASSIGNED",
        version: { increment: 1 }
      }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: CONTEXT_RETIRED_ACTION,
      actor: input.actor,
      evidenceReference: `successor-plan:${loaded.successorPlanId}`,
      onboardingPlanId: loaded.plan.id,
      reason: `${input.reason.trim()} Successor plan: ${loaded.successorPlanId}. No event was created, released, claimed, or dispatched.`,
      recipientEmail: loaded.owner.email
    });
    return { changed: true } as const;
  });
}

export async function restoreRetiredCommunicationContext(input: {
  actor: string;
  confirmation: string;
  planId: string;
  successorPlanId: string;
}) {
  assertDormantContextAdministration();
  if (input.confirmation !== RESTORE_CONTEXT_CONFIRMATION) {
    throw new ZohoAdminValidationError("Enter the exact communication-context restoration confirmation phrase.");
  }
  const loaded = await loadRetirementTarget(input.planId, input.successorPlanId.trim());
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${loaded.owner.normalizedEmail}`}, 0))
    `);
    const [currentPlan, context, successor, retirement] = await Promise.all([
      transaction.onboardingPlan.findUnique({
        where: { id: loaded.plan.id },
        select: {
          automationEnrollmentState: true,
          planContacts: {
            where: { id: loaded.owner.id, normalizedEmail: loaded.owner.normalizedEmail, role: "ONBOARDING_OWNER" },
            take: 1,
            select: { automationEnabled: true, id: true }
          }
        }
      }),
      transaction.zohoCommunicationContext.findUnique({ where: { recipientEmailNormalized: loaded.owner.normalizedEmail } }),
      transaction.onboardingPlan.findUnique({ where: { planId: loaded.successorPlanId }, select: { id: true } }),
      transaction.zohoAutomationAudit.findFirst({
        where: {
          action: CONTEXT_RETIRED_ACTION,
          onboardingPlanId: loaded.plan.id,
          recipientEmailNormalized: loaded.owner.normalizedEmail,
          evidenceReference: `successor-plan:${loaded.successorPlanId}`
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true }
      })
    ]);
    const currentOwner = currentPlan?.planContacts[0];
    if (!currentPlan || !currentOwner) throw new ZohoAdminValidationError("The retired plan or Onboarding Owner changed and cannot be restored here.", 409);
    if (successor) throw new ZohoAdminValidationError("The successor plan now exists; its ownership must not be overwritten by restoration.", 409);
    if (!retirement) throw new ZohoAdminValidationError("No matching audited retirement can be restored.", 409);
    if (context?.state === "ACTIVE" && context.activePlanId === loaded.plan.id) {
      if (currentPlan.automationEnrollmentState === "ACTIVE" && currentOwner.automationEnabled) return { changed: false } as const;
      throw new ZohoAdminValidationError("The restored context and plan state disagree. Manual review is required.", 409);
    }
    if (context?.state !== "UNASSIGNED" || context.activePlanId !== null || context.processingClaimId) {
      throw new ZohoAdminValidationError("The communication context is no longer safely restorable.", 409);
    }
    if (currentPlan.automationEnrollmentState !== "PAUSED" || currentOwner.automationEnabled) {
      throw new ZohoAdminValidationError("The retired plan state changed and cannot be restored through this operation.", 409);
    }

    const now = new Date();
    await transaction.onboardingPlan.update({ where: { id: loaded.plan.id }, data: { automationEnrollmentState: "ACTIVE" } });
    await transaction.planContact.update({ where: { id: currentOwner.id }, data: { automationEnabled: true } });
    await transaction.zohoCommunicationContext.update({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail },
      data: {
        acquiredAt: now,
        acquiredBy: input.actor,
        acquisitionReason: "Explicit ADMIN restoration before successor-plan creation.",
        activePlanId: loaded.plan.id,
        state: "ACTIVE",
        version: { increment: 1 }
      }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: CONTEXT_RESTORED_ACTION,
      actor: input.actor,
      evidenceReference: `successor-plan:${loaded.successorPlanId}`,
      onboardingPlanId: loaded.plan.id,
      reason: "Restored the previously retired communication context before successor-plan creation. No event was created, released, claimed, or dispatched.",
      recipientEmail: loaded.owner.email
    });
    return { changed: true } as const;
  });
}
