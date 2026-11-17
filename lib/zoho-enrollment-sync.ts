import "server-only";

import { getZohoDispatchConfiguration, getZohoMspEnrollmentSyncConfiguration } from "@/lib/zoho-config";
import {
  createStableZohoKey,
  createZohoAutomationAuditInTransaction,
  createZohoContactSyncEventInTransaction,
  isZohoEventEmissionEnabled
} from "@/lib/zoho-foundation";
import {
  evaluateEnrollmentContactSync,
  shouldRecordEnrollmentContactPermission,
  validateEnrollmentContactPermission
} from "@/lib/zoho-enrollment-sync-core";
import { prisma } from "@/lib/prisma";

export type EnrollmentContactPermission = {
  confirmed: boolean;
  evidenceReference?: string;
};

export async function prepareMspEnrollmentContactSync(input: {
  actor: string;
  actorAttributable: boolean;
  onboardingPlanId: string;
  permission?: EnrollmentContactPermission;
}) {
  return prisma.$transaction(async (transaction) => {
    const plan = await transaction.onboardingPlan.findUnique({
      where: { id: input.onboardingPlanId },
      select: {
        automationEnrollmentState: true,
        id: true,
        planContacts: {
          where: { role: "ONBOARDING_OWNER" },
          orderBy: { createdAt: "asc" },
          select: { automationEnabled: true, email: true, id: true, normalizedEmail: true },
          take: 1
        },
        planId: true
      }
    });
    if (!plan || !plan.planContacts[0]) return { eventCreated: false, reason: "ONBOARDING_OWNER_NOT_FOUND" };

    const contact = plan.planContacts[0];
    const evidenceReference = input.permission?.evidenceReference?.trim() ?? "";
    const permissionConfirmed = input.permission?.confirmed === true && Boolean(evidenceReference);
    if (permissionConfirmed) {
      await createZohoAutomationAuditInTransaction(transaction, {
        action: "msp_enrollment.contact_permission_recorded",
        actor: input.actor,
        evidenceReference,
        onboardingPlanId: plan.id,
        reason: "Administrator-recorded permission evidence for an email-only list add; this does not independently prove marketing consent or provider subscription eligibility.",
        recipientEmail: contact.email
      });
    }

    const context = await transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: contact.normalizedEmail },
      select: { activePlanId: true, state: true }
    });
    const dispatch = getZohoDispatchConfiguration();
    const decision = evaluateEnrollmentContactSync({
      automaticDispatchEnabled: dispatch.automaticDispatchEnabled,
      communicationContextOwned: context?.state === "ACTIVE" && context.activePlanId === plan.id,
      contactAutomationEnabled: contact.automationEnabled,
      contactSyncEnabled: dispatch.contactSyncEnabled,
      eventEmissionEnabled: isZohoEventEmissionEnabled(),
      evidenceReference,
      globalKillSwitch: dispatch.globalKillSwitch,
      individualStaffIdentity: input.actorAttributable,
      permissionConfirmed,
      planAutomationActive: plan.automationEnrollmentState === "ACTIVE",
      productionApproved: dispatch.productionApproved,
      productionMode: dispatch.mode === "production",
      syncOnEnrollmentEnabled: getZohoMspEnrollmentSyncConfiguration().enabled
    });

    if (decision.action === "SKIP") {
      await createZohoAutomationAuditInTransaction(transaction, {
        action: "msp_enrollment.contact_sync_skipped",
        actor: input.actor,
        evidenceReference: evidenceReference || undefined,
        onboardingPlanId: plan.id,
        reason: decision.reason,
        recipientEmail: contact.email
      });
      return { eventCreated: false, reason: decision.reason };
    }

    const event = await createZohoContactSyncEventInTransaction(transaction, {
      eventKey: createStableZohoKey("contact-sync", "msp-enrolled", plan.planId, contact.normalizedEmail),
      holdReason: decision.holdReason ?? undefined,
      onboardingPlanId: plan.id,
      payload: {
        schemaVersion: 3,
        event: { occurrenceKey: `msp-enrolled:${plan.planId}`, reason: "msp.enrolled.contact_sync" },
        permissionAuditRequired: true,
        revalidateBeforeDispatch: true,
        syncMode: "EMAIL_ONLY"
      },
      recipientEmail: contact.email,
      status: decision.status
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "msp_enrollment.contact_sync_prepared",
      actor: input.actor,
      evidenceReference,
      onboardingPlanId: plan.id,
      reason: decision.holdReason ?? "Email-only contact synchronization was queued.",
      recipientEmail: contact.email
    });
    return { eventCreated: event.created, reason: decision.holdReason ?? "PENDING" };
  });
}

export async function recordMspEnrollmentContactSyncPreparationFailure(input: {
  actor: string;
  onboardingPlanId: string;
}) {
  try {
    await prisma.$transaction((transaction) => createZohoAutomationAuditInTransaction(transaction, {
      action: "msp_enrollment.contact_sync_preparation_failed",
      actor: input.actor,
      onboardingPlanId: input.onboardingPlanId,
      reason: "Post-enrollment Zoho contact-sync preparation failed; the MSP enrollment remains committed."
    }));
    return true;
  } catch {
    return false;
  }
}

export async function recordExistingMspContactPermission(input: {
  actor: string;
  evidenceReference: string;
  permissionConfirmed: boolean;
  planId: string;
}) {
  const permission = validateEnrollmentContactPermission({
    confirmed: input.permissionConfirmed,
    evidenceReference: input.evidenceReference
  });
  if (!permission.confirmed || !permission.valid) {
    throw new Error("Permission confirmation and an evidence reference are required.");
  }

  return prisma.$transaction(async (transaction) => {
    const plan = await transaction.onboardingPlan.findUnique({
      where: { planId: input.planId },
      select: {
        id: true,
        msp: { select: { primaryContactEmail: true } },
        planContacts: {
          where: { role: "ONBOARDING_OWNER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { email: true, normalizedEmail: true }
        }
      }
    });
    const owner = plan?.planContacts[0];
    const primaryEmail = plan?.msp.primaryContactEmail.trim().toLowerCase();
    if (!plan || !owner || owner.normalizedEmail !== primaryEmail) {
      throw new Error("The MSP primary contact must match the plan's Onboarding Owner before permission can be recorded.");
    }

    const lockKey = `msp-contact-permission:${plan.id}:${owner.normalizedEmail}`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const existing = await transaction.zohoAutomationAudit.findMany({
      where: {
        action: "msp_enrollment.contact_permission_recorded",
        onboardingPlanId: plan.id,
        recipientEmailNormalized: owner.normalizedEmail
      },
      select: { evidenceReference: true }
    });
    if (!shouldRecordEnrollmentContactPermission({
      evidenceReference: permission.evidenceReference,
      existingEvidenceReferences: existing.map((audit) => audit.evidenceReference)
    })) {
      return { created: false } as const;
    }

    await createZohoAutomationAuditInTransaction(transaction, {
      action: "msp_enrollment.contact_permission_recorded",
      actor: input.actor,
      evidenceReference: permission.evidenceReference,
      onboardingPlanId: plan.id,
      reason: "Administrator-recorded permission evidence for an email-only list add; this does not independently prove marketing consent or provider subscription eligibility.",
      recipientEmail: owner.email
    });
    return { created: true } as const;
  });
}
