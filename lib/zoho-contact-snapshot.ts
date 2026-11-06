import "server-only";
import { prisma } from "@/lib/prisma";
import { createZohoContactSnapshot, ZohoContactMappingError } from "@/lib/zoho-contact-mapping";
import { getZohoPublicPortalBaseUrl } from "@/lib/zoho-config";
import { getTaskGuides } from "@/lib/guide-previews";
import { getTaskTimeEstimateMinutes } from "@/lib/onboarding-time-estimates";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";
import type { ZohoTransaction } from "@/lib/zoho-foundation";

type SnapshotClient = ZohoTransaction | typeof prisma;

export async function getPersistedZohoContactSnapshotWithClient(
  client: SnapshotClient,
  planId: string,
  contactId: string
) {
  const plan = await client.onboardingPlan.findUnique({
    where: { planId },
    select: {
      assignedSeBookingUrl: true,
      assignedSeEmail: true,
      assignedSeName: true,
      automationEnrollmentState: true,
      automationOrigin: true,
      automationTaskMappingState: true,
      id: true,
      kickoffBookedAt: true,
      lastActivityAt: true,
      nextTaskSince: true,
      nudgeStatus: true,
      planContacts: {
        where: { id: contactId },
        select: {
          automationEnabled: true,
          email: true,
          firstName: true,
          id: true,
          lastName: true,
          normalizedEmail: true,
          role: true,
          subscriptionStatus: true
        }
      },
      planId: true,
      progress: true,
      currentStage: true,
      status: true,
      tenantType: true,
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: {
          owner: true,
          order: true,
          status: true,
          templateKey: true,
          title: true
        }
      },
      saasAppSubmissions: {
        select: { status: true }
      }
    }
  });
  if (!plan) throw new ZohoAdminValidationError("Onboarding plan not found.", 404);
  const contact = plan.planContacts[0];
  if (!contact) throw new ZohoAdminValidationError("Plan contact not found.", 404);
  if (!contact.automationEnabled) {
    throw new ZohoAdminValidationError("The selected contact is not eligible for automation.", 409);
  }
  if (plan.automationTaskMappingState !== "VERIFIED") {
    throw new ZohoAdminValidationError("Stable task mappings must be verified before synchronization.", 409);
  }
  if (plan.onboardingTasks.some((task) => !task.templateKey)) {
    throw new ZohoAdminValidationError("One or more tasks do not have stable template keys.", 409);
  }

  const nextTask =
    plan.onboardingTasks.find((task) => task.status !== "complete") ??
    plan.onboardingTasks.at(-1);
  if (!nextTask?.templateKey) {
    throw new ZohoAdminValidationError("The plan has no stable task available for synchronization.", 409);
  }
  const guides = getTaskGuides(nextTask.templateKey);
  const portalBaseUrl = getZohoPublicPortalBaseUrl();
  if (!portalBaseUrl) {
    throw new ZohoAdminValidationError("A valid public portal base URL is required.", 503);
  }

  let snapshot;
  try {
    snapshot = createZohoContactSnapshot({
      appsApproved: plan.saasAppSubmissions.filter((app) => app.status === "approved_for_sso").length,
      appsSubmitted: plan.saasAppSubmissions.length,
      contact,
      kickoffBookedAt: plan.kickoffBookedAt,
      lastMspActivity: plan.lastActivityAt,
      lastSeTouch: null,
      nextTask: {
        guideUrl: guides[0]?.href ?? null,
        minutes: getTaskTimeEstimateMinutes(nextTask.templateKey),
        owner: nextTask.owner,
        since: plan.nextTaskSince,
        status: nextTask.status,
        templateKey: nextTask.templateKey,
        tip: null,
        title: nextTask.title
      },
      nudgeStatus: plan.nudgeStatus,
      plan,
      portalBaseUrl,
      salesEngineer: {
        bookingUrl: plan.assignedSeBookingUrl,
        email: plan.assignedSeEmail,
        name: plan.assignedSeName
      }
    });
  } catch (error) {
    if (error instanceof ZohoContactMappingError) {
      throw new ZohoAdminValidationError(error.message, 409);
    }
    throw error;
  }

  return {
    contact,
    plan: {
      automationEnrollmentState: plan.automationEnrollmentState,
      automationOrigin: plan.automationOrigin,
      id: plan.id,
      planId: plan.planId
    },
    snapshot
  };
}

export function getPersistedZohoContactSnapshot(planId: string, contactId: string) {
  return getPersistedZohoContactSnapshotWithClient(prisma, planId, contactId);
}
