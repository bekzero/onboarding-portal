import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createZohoAutomationAuditInTransaction,
  type ZohoTransaction
} from "@/lib/zoho-foundation";
import { recordZohoContactSyncEventsInTransaction } from "@/lib/zoho-lifecycle-events";
import { getZohoAutomationReadiness } from "@/lib/zoho-readiness";
import {
  normalizePlanContactInput,
  normalizeSalesEngineerInput,
  ZohoAdminValidationError
} from "@/lib/zoho-validation";

const contactSelection = {
  automationEnabled: true,
  createdAt: true,
  email: true,
  firstName: true,
  id: true,
  lastName: true,
  normalizedEmail: true,
  role: true,
  subscriptionStatus: true,
  subscriptionVerifiedAt: true,
  updatedAt: true
} satisfies Prisma.PlanContactSelect;

function throwKnownContactError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ZohoAdminValidationError("That email already has this role on the plan.", 409);
  }
  throw error;
}

async function getPlanOrThrow(transaction: ZohoTransaction, planId: string) {
  const plan = await transaction.onboardingPlan.findUnique({
    where: { planId },
    select: {
      automationEnrollmentState: true,
      id: true,
      mspId: true,
      planId: true
    }
  });
  if (!plan) {
    throw new ZohoAdminValidationError("Onboarding plan not found.", 404);
  }

  return plan;
}

async function assertActivePlanKeepsOwner(
  transaction: ZohoTransaction,
  plan: { automationEnrollmentState: string; id: string },
  excludedContactId?: string
) {
  if (plan.automationEnrollmentState !== "ACTIVE") {
    return;
  }

  const remainingOwnerCount = await transaction.planContact.count({
    where: {
      automationEnabled: true,
      id: excludedContactId ? { not: excludedContactId } : undefined,
      onboardingPlanId: plan.id,
      role: "ONBOARDING_OWNER"
    }
  });
  if (remainingOwnerCount === 0) {
    throw new ZohoAdminValidationError(
      "An automation-active plan must retain an eligible Onboarding Owner.",
      409
    );
  }
}

export async function getPlanAutomationAdminDetails(planId: string) {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { planId },
    select: {
      assignedSeBookingUrl: true,
      assignedSeEmail: true,
      assignedSeName: true,
      automationEnrollmentState: true,
      automationOrigin: true,
      kickoffBookedAt: true,
      kickoffBookedBy: true,
      planContacts: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: contactSelection
      }
    }
  });
  if (!plan) {
    return null;
  }

  const readiness = await getZohoAutomationReadiness(planId);
  return { ...plan, contacts: plan.planContacts, readiness };
}

export async function addPlanContact(
  planId: string,
  input: Parameters<typeof normalizePlanContactInput>[0],
  actor: string
) {
  const contactInput = normalizePlanContactInput(input);

  try {
    return await prisma.$transaction(async (transaction) => {
      const plan = await getPlanOrThrow(transaction, planId);
      const contact = await transaction.planContact.create({
        data: {
          ...contactInput,
          onboardingPlanId: plan.id
        },
        select: contactSelection
      });
      await createZohoAutomationAuditInTransaction(transaction, {
        action: "plan_contact.created",
        actor,
        onboardingPlanId: plan.id,
        reason: `Added ${contact.role.toLowerCase().replaceAll("_", " ")} contact.`,
        recipientEmail: contact.email
      });
      await recordZohoContactSyncEventsInTransaction(transaction, {
        occurrenceKey: `plan-contact-created:${contact.id}`,
        onboardingPlanId: plan.id,
        reason: "plan_contact.created",
        recipientRoles: [contact.role]
      });
      return contact;
    });
  } catch (error) {
    throwKnownContactError(error);
  }
}

export async function updatePlanContact(
  planId: string,
  contactId: string,
  input: Parameters<typeof normalizePlanContactInput>[0],
  actor: string
) {
  const contactInput = normalizePlanContactInput(input);

  try {
    return await prisma.$transaction(async (transaction) => {
      const plan = await getPlanOrThrow(transaction, planId);
      const existing = await transaction.planContact.findFirst({
        where: { id: contactId, onboardingPlanId: plan.id }
      });
      if (!existing) {
        throw new ZohoAdminValidationError("Contact not found.", 404);
      }

      const contactChanged =
        existing.automationEnabled !== contactInput.automationEnabled ||
        existing.email !== contactInput.email ||
        existing.firstName !== contactInput.firstName ||
        existing.lastName !== contactInput.lastName ||
        existing.role !== contactInput.role;
      if (!contactChanged) {
        return transaction.planContact.findUniqueOrThrow({
          where: { id: existing.id },
          select: contactSelection
        });
      }

      if (
        plan.automationEnrollmentState === "ACTIVE" &&
        existing.role === "ONBOARDING_OWNER" &&
        contactInput.role !== "ONBOARDING_OWNER"
      ) {
        const otherOwnerCount = await transaction.planContact.count({
          where: {
            id: { not: existing.id },
            onboardingPlanId: plan.id,
            role: "ONBOARDING_OWNER"
          }
        });
        if (otherOwnerCount === 0) {
          throw new ZohoAdminValidationError(
            "The only Onboarding Owner cannot be changed to another role while automation is active.",
            409
          );
        }
      }

      const removesEligibleOwner =
        existing.role === "ONBOARDING_OWNER" &&
        existing.automationEnabled &&
        (contactInput.role !== "ONBOARDING_OWNER" || !contactInput.automationEnabled);
      if (removesEligibleOwner) {
        await assertActivePlanKeepsOwner(transaction, plan, existing.id);
      }

      const contact = await transaction.planContact.update({
        where: { id: existing.id },
        data: {
          ...contactInput,
          ...(existing.normalizedEmail !== contactInput.normalizedEmail
            ? {
                subscriptionEvidenceReference: null,
                subscriptionStatus: "UNKNOWN" as const,
                subscriptionVerificationSource: null,
                subscriptionVerifiedAt: null,
                subscriptionVerifiedBy: null
              }
            : {})
        },
        select: contactSelection
      });
      await createZohoAutomationAuditInTransaction(transaction, {
        action: "plan_contact.updated",
        actor,
        onboardingPlanId: plan.id,
        reason: "Updated onboarding contact details.",
        recipientEmail: contact.email
      });
      await recordZohoContactSyncEventsInTransaction(transaction, {
        occurrenceKey: `plan-contact-updated:${contact.id}:${contact.updatedAt.toISOString()}`,
        onboardingPlanId: plan.id,
        reason: "plan_contact.updated",
        recipientRoles: [contact.role]
      });
      return contact;
    });
  } catch (error) {
    throwKnownContactError(error);
  }
}

export async function removePlanContact(planId: string, contactId: string, actor: string) {
  return prisma.$transaction(async (transaction) => {
    const plan = await getPlanOrThrow(transaction, planId);
    const contact = await transaction.planContact.findFirst({
      where: { id: contactId, onboardingPlanId: plan.id }
    });
    if (!contact) {
      throw new ZohoAdminValidationError("Contact not found.", 404);
    }

    if (contact.role === "ONBOARDING_OWNER" && plan.automationEnrollmentState === "ACTIVE") {
      const ownerCount = await transaction.planContact.count({
        where: { onboardingPlanId: plan.id, role: "ONBOARDING_OWNER" }
      });
      if (ownerCount <= 1) {
        throw new ZohoAdminValidationError(
          "The only Onboarding Owner cannot be removed while automation is active.",
          409
        );
      }
      if (contact.automationEnabled) {
        await assertActivePlanKeepsOwner(transaction, plan, contact.id);
      }
    }

    await transaction.planContact.delete({ where: { id: contact.id } });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "plan_contact.removed",
      actor,
      onboardingPlanId: plan.id,
      reason: `Removed ${contact.role.toLowerCase().replaceAll("_", " ")} contact.`,
      recipientEmail: contact.email
    });
    await recordZohoContactSyncEventsInTransaction(transaction, {
      occurrenceKey: `plan-contact-removed:${contact.id}`,
      onboardingPlanId: plan.id,
      reason: "plan_contact.removed"
    });
    return contact;
  });
}

export async function updatePlanSalesEngineer(
  planId: string,
  input: { bookingUrl?: unknown; email?: unknown; name?: unknown },
  actor: string
) {
  const salesEngineer = normalizeSalesEngineerInput(input);

  return prisma.$transaction(async (transaction) => {
    const plan = await getPlanOrThrow(transaction, planId);
    const existing = await transaction.onboardingPlan.findUniqueOrThrow({ where: { id: plan.id } });
    if (
      existing.assignedSeName === salesEngineer.assignedSeName &&
      existing.assignedSeEmail === salesEngineer.assignedSeEmail &&
      existing.assignedSeBookingUrl === salesEngineer.assignedSeBookingUrl
    ) {
      return {
        assignedSeBookingUrl: existing.assignedSeBookingUrl,
        assignedSeEmail: existing.assignedSeEmail,
        assignedSeName: existing.assignedSeName
      };
    }
    const updatedPlan = await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: salesEngineer,
      select: {
        assignedSeBookingUrl: true,
        assignedSeEmail: true,
        assignedSeName: true
      }
    });

    if (salesEngineer.assignedSeName) {
      await transaction.msp.update({
        where: { id: plan.mspId },
        data: { assignedSalesEngineer: salesEngineer.assignedSeName }
      });
    }
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "sales_engineer.updated",
      actor,
      onboardingPlanId: plan.id,
      reason: "Updated assigned Sales Engineer merge-field details."
    });
    await recordZohoContactSyncEventsInTransaction(transaction, {
      occurrenceKey: `sales-engineer-updated:${plan.planId}:${new Date().toISOString()}`,
      onboardingPlanId: plan.id,
      reason: "sales_engineer.updated"
    });

    return updatedPlan;
  });
}

function parseCorrectionTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ZohoAdminValidationError("A corrected booking timestamp is required.");
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new ZohoAdminValidationError("Enter a valid corrected booking timestamp.");
  }
  if (timestamp.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new ZohoAdminValidationError("The booking confirmation timestamp cannot be in the future.");
  }
  return timestamp;
}

export async function updateKickoffBooking(
  planId: string,
  input: { action: "book" | "cancel" | "correct"; bookedAt?: unknown; reason?: unknown },
  actor: string
) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if ((input.action === "cancel" || input.action === "correct") && !reason) {
    throw new ZohoAdminValidationError("A reason is required to correct or cancel a booking.");
  }

  return prisma.$transaction(async (transaction) => {
    const plan = await transaction.onboardingPlan.findUnique({ where: { planId } });
    if (!plan) {
      throw new ZohoAdminValidationError("Onboarding plan not found.", 404);
    }

    if (input.action === "cancel") {
      if (!plan.kickoffBookedAt) {
        return { changed: false, eventCount: 0, kickoffBookedAt: null, kickoffBookedBy: null };
      }
      const updated = await transaction.onboardingPlan.update({
        where: { id: plan.id },
        data: { kickoffBookedAt: null, kickoffBookedBy: null }
      });
      await createZohoAutomationAuditInTransaction(transaction, {
        action: "kickoff_booking.cancelled",
        actor,
        onboardingPlanId: plan.id,
        reason
      });
      const events = await recordZohoContactSyncEventsInTransaction(transaction, {
        occurrenceKey: `kickoff-cancelled:${plan.planId}:${plan.kickoffBookedAt.toISOString()}`,
        onboardingPlanId: plan.id,
        reason: "kickoff_booking.cancelled",
        taskKey: "book-kickoff"
      });
      return {
        changed: true,
        eventCount: events.length,
        kickoffBookedAt: updated.kickoffBookedAt,
        kickoffBookedBy: updated.kickoffBookedBy
      };
    }

    if (input.action === "book" && plan.kickoffBookedAt) {
      return {
        changed: false,
        eventCount: 0,
        kickoffBookedAt: plan.kickoffBookedAt,
        kickoffBookedBy: plan.kickoffBookedBy
      };
    }

    const bookedAt = input.action === "correct" ? parseCorrectionTimestamp(input.bookedAt) : new Date();
    const updated = await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: { kickoffBookedAt: bookedAt, kickoffBookedBy: actor }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: input.action === "correct" ? "kickoff_booking.corrected" : "kickoff_booking.booked",
      actor,
      onboardingPlanId: plan.id,
      reason: reason || "Kickoff booking confirmed by an authorized administrator."
    });
    const events = await recordZohoContactSyncEventsInTransaction(transaction, {
      allowStopState: true,
      isStopState: true,
      occurrenceKey: `${input.action === "correct" ? "kickoff-corrected" : "kickoff-booked"}:${plan.planId}:${bookedAt.toISOString()}`,
      onboardingPlanId: plan.id,
      reason: input.action === "correct" ? "kickoff_booking.corrected" : "kickoff_booking.booked",
      taskKey: "book-kickoff"
    });

    return {
      changed: true,
      eventCount: events.length,
      kickoffBookedAt: updated.kickoffBookedAt,
      kickoffBookedBy: updated.kickoffBookedBy
    };
  });
}

export function getZohoAdminErrorStatus(error: unknown) {
  return error instanceof ZohoAdminValidationError ? error.status : 500;
}
