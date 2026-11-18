import "server-only";

import { getZohoApiClient } from "@/lib/zoho-api";
import {
  getZohoDispatchConfiguration,
  getZohoListKey,
  getZohoMspEnrollmentPilotConfiguration,
  getZohoMspEnrollmentSyncConfiguration,
  ZOHO_TEST_MAILING_LIST_NAME
} from "@/lib/zoho-config";
import { createZohoAutomationAuditInTransaction, isZohoEventEmissionEnabled } from "@/lib/zoho-foundation";
import { prisma } from "@/lib/prisma";
import { isValidEmailAddress, ZohoAdminValidationError } from "@/lib/zoho-validation";

export const LIST_PRIVACY_AUDIT_ACTION = "zoho.mailing_list.privacy_verified";

function assertPilotAdministrationSafeguards() {
  const dispatch = getZohoDispatchConfiguration();
  if (
    !dispatch.globalKillSwitch ||
    dispatch.automaticDispatchEnabled ||
    dispatch.contactSyncEnabled ||
    dispatch.journeyTriggeringEnabled ||
    dispatch.productionApproved ||
    isZohoEventEmissionEnabled() ||
    getZohoMspEnrollmentSyncConfiguration().enabled
  ) {
    throw new ZohoAdminValidationError(
      "Pilot readiness administration is available only while every production automation control is disabled and the global kill switch is enabled.",
      409
    );
  }
}

async function loadPilotPlan(planId: string) {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    select: {
      automationEnrollmentState: true,
      automationOrigin: true,
      id: true,
      msp: { select: { primaryContactEmail: true } },
      planContacts: {
        where: { role: "ONBOARDING_OWNER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          automationEnabled: true,
          email: true,
          normalizedEmail: true,
          subscriptionStatus: true
        }
      }
    }
  });
  if (!plan) throw new ZohoAdminValidationError("Onboarding plan not found.", 404);

  const owner = plan.planContacts[0];
  const primaryEmail = plan.msp.primaryContactEmail.trim().toLowerCase();
  const pilot = getZohoMspEnrollmentPilotConfiguration();
  if (!pilot.configured || pilot.planId !== planId || pilot.email !== primaryEmail) {
    throw new ZohoAdminValidationError("This plan and primary contact are not the configured single-contact pilot target.", 403);
  }
  if (!owner || !isValidEmailAddress(owner.email) || !isValidEmailAddress(plan.msp.primaryContactEmail) || owner.normalizedEmail !== primaryEmail) {
    throw new ZohoAdminValidationError("The primary contact must be a valid matching Onboarding Owner.", 409);
  }
  return { owner, plan, primaryEmail };
}

async function requireIndividuallyRecordedPermission(planId: string, recipientEmailNormalized: string) {
  const permission = await prisma.zohoAutomationAudit.findFirst({
    where: {
      action: "msp_enrollment.contact_permission_recorded",
      onboardingPlanId: planId,
      recipientEmailNormalized,
      actor: { startsWith: "oidc:" }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!permission) {
    throw new ZohoAdminValidationError("Individually attributable permission evidence is required before pilot administration.", 409);
  }
}

export async function approvePilotPlanAutomation(input: { actor: string; planId: string }) {
  assertPilotAdministrationSafeguards();
  const loaded = await loadPilotPlan(input.planId);
  await requireIndividuallyRecordedPermission(loaded.plan.id, loaded.owner.normalizedEmail);
  if (loaded.plan.automationOrigin !== "NATIVE") {
    throw new ZohoAdminValidationError("Legacy plans require the separate historical enrollment workflow.", 409);
  }
  if (["EXCLUDED", "PAUSED", "COMPLETE"].includes(loaded.plan.automationEnrollmentState)) {
    throw new ZohoAdminValidationError("The plan's current automation state cannot be approved through the pilot workflow.", 409);
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-pilot-approval:${loaded.plan.id}`}, 0))`;
    const current = await transaction.onboardingPlan.findUnique({
      where: { id: loaded.plan.id },
      select: {
        automationEnrollmentState: true,
        planContacts: {
          where: { role: "ONBOARDING_OWNER", normalizedEmail: loaded.owner.normalizedEmail },
          take: 1,
          select: { automationEnabled: true, id: true }
        }
      }
    });
    const contact = current?.planContacts[0];
    if (!current || !contact) throw new ZohoAdminValidationError("The pilot plan or Onboarding Owner changed. Re-evaluate readiness.", 409);
    if (current.automationEnrollmentState === "ACTIVE" && contact.automationEnabled) return { changed: false } as const;
    if (["EXCLUDED", "PAUSED", "COMPLETE"].includes(current.automationEnrollmentState)) {
      throw new ZohoAdminValidationError("The plan's automation state changed and can no longer be approved here.", 409);
    }

    const approvedAt = new Date();
    await transaction.onboardingPlan.update({
      where: { id: loaded.plan.id },
      data: {
        automationEnrolledAt: approvedAt,
        automationEnrolledBy: input.actor,
        automationEnrollmentState: "ACTIVE"
      }
    });
    await transaction.planContact.update({ where: { id: contact.id }, data: { automationEnabled: true } });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "msp_pilot.automation_approved",
      actor: input.actor,
      onboardingPlanId: loaded.plan.id,
      reason: "Approved this native plan and its Onboarding Owner for controlled pilot readiness. No event was created or released.",
      recipientEmail: loaded.owner.email
    });
    return { changed: true } as const;
  });
}

export async function assignPilotCommunicationContext(input: { actor: string; planId: string }) {
  assertPilotAdministrationSafeguards();
  const loaded = await loadPilotPlan(input.planId);
  await requireIndividuallyRecordedPermission(loaded.plan.id, loaded.owner.normalizedEmail);
  if (loaded.plan.automationEnrollmentState !== "ACTIVE" || !loaded.owner.automationEnabled) {
    throw new ZohoAdminValidationError("Approve the plan and Onboarding Owner before assigning communication context.", 409);
  }
  if (loaded.owner.subscriptionStatus === "INELIGIBLE") {
    throw new ZohoAdminValidationError("An ineligible recipient cannot own an active communication context.", 409);
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${loaded.owner.normalizedEmail}`}, 0))`;
    const currentPlan = await transaction.onboardingPlan.findUnique({
      where: { id: loaded.plan.id },
      select: {
        automationEnrollmentState: true,
        planContacts: {
          where: { role: "ONBOARDING_OWNER", normalizedEmail: loaded.owner.normalizedEmail },
          take: 1,
          select: { automationEnabled: true }
        }
      }
    });
    if (currentPlan?.automationEnrollmentState !== "ACTIVE" || currentPlan.planContacts[0]?.automationEnabled !== true) {
      throw new ZohoAdminValidationError("Plan or Onboarding Owner approval changed. Re-evaluate readiness.", 409);
    }
    const context = await transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail }
    });
    if (context?.state === "ACTIVE" && context.activePlanId === loaded.plan.id) return { changed: false } as const;
    if (context && (context.state !== "UNASSIGNED" || (context.activePlanId && context.activePlanId !== loaded.plan.id))) {
      throw new ZohoAdminValidationError("The contact's communication context is blocked, pending release, or owned by another plan.", 409);
    }
    const competing = await transaction.planContact.findFirst({
      where: {
        automationEnabled: true,
        normalizedEmail: loaded.owner.normalizedEmail,
        onboardingPlan: { automationEnrollmentState: "ACTIVE", id: { not: loaded.plan.id } }
      },
      select: { id: true }
    });
    if (competing) throw new ZohoAdminValidationError("Another active plan uses this communication identity.", 409);

    const acquiredAt = new Date();
    await transaction.zohoCommunicationContext.upsert({
      where: { recipientEmailNormalized: loaded.owner.normalizedEmail },
      create: {
        acquiredAt,
        acquiredBy: input.actor,
        acquisitionReason: "Explicit ADMIN assignment for the controlled single-contact pilot.",
        activePlanId: loaded.plan.id,
        recipientEmailNormalized: loaded.owner.normalizedEmail,
        state: "ACTIVE"
      },
      update: {
        acquiredAt,
        acquiredBy: input.actor,
        acquisitionReason: "Explicit ADMIN assignment for the controlled single-contact pilot.",
        activePlanId: loaded.plan.id,
        state: "ACTIVE",
        version: { increment: 1 }
      }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "msp_pilot.communication_context_assigned",
      actor: input.actor,
      onboardingPlanId: loaded.plan.id,
      reason: "Assigned this plan as the active communication context for the controlled pilot. No event was created or released.",
      recipientEmail: loaded.owner.email
    });
    return { changed: true } as const;
  });
}

export async function verifyPilotMailingListPrivacy(input: { actor: string; planId: string }) {
  assertPilotAdministrationSafeguards();
  await loadPilotPlan(input.planId);
  const listKey = getZohoListKey();
  if (!listKey) throw new ZohoAdminValidationError("The Zoho mailing-list key is not configured.", 503);

  const discovery = await getZohoApiClient().discoverMailingLists({ maxPages: 10, pageSize: 100 });
  const matches = discovery.lists.filter((list) => list.listKey === listKey && list.listName === ZOHO_TEST_MAILING_LIST_NAME);
  if (matches.length !== 1) {
    throw new ZohoAdminValidationError("The configured KZero Partner Onboarding mailing list could not be identified unambiguously.", 409);
  }
  if (matches[0].isPublic !== false) {
    throw new ZohoAdminValidationError(
      matches[0].isPublic === null
        ? "Zoho did not return authoritative mailing-list privacy evidence. Verify the setting manually with Zoho Support."
        : "The configured KZero Partner Onboarding mailing list is public and cannot be approved.",
      409
    );
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('zoho-list-privacy-verification', 0))`;
    const existing = await transaction.zohoAutomationAudit.findFirst({
      where: { action: LIST_PRIVACY_AUDIT_ACTION, evidenceReference: "getmailinglists:is_public=false" },
      select: { id: true }
    });
    if (existing) return { changed: false } as const;
    await createZohoAutomationAuditInTransaction(transaction, {
      action: LIST_PRIVACY_AUDIT_ACTION,
      actor: input.actor,
      evidenceReference: "getmailinglists:is_public=false",
      reason: "The documented read-only Get Mailing Lists API identified the configured KZero Partner Onboarding list and reported is_public=false."
    });
    return { changed: true } as const;
  });
}

export async function getPersistedListPrivacyVerification() {
  return prisma.zohoAutomationAudit.findFirst({
    where: { action: LIST_PRIVACY_AUDIT_ACTION },
    orderBy: { createdAt: "desc" },
    select: { actor: true, createdAt: true, evidenceReference: true }
  });
}
