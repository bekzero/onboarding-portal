import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkZohoListMembership } from "@/lib/zoho-phase2";
import {
  getZohoConfigurationStatus,
  getZohoDispatchConfiguration,
  getZohoTopicId,
  isZohoProductionJourneyEnabled,
  isZohoProductionRolloutRecipientAllowed,
  isZohoProductionRuntime
} from "@/lib/zoho-config";
import { createZohoAutomationAuditInTransaction } from "@/lib/zoho-foundation";
import { prepareZohoEmailAutomationEventsInTransaction } from "@/lib/zoho-lifecycle-events";
import {
  evaluateEmailAutomationEnablement,
  isEmailAutomationContactConfigurationReady,
  selectKZeroEmailSchedule,
  type EmailAutomationEnablementInput
} from "@/lib/zoho-email-automation-core";
import { isValidEmailAddress, isValidHttpUrl, ZohoAdminValidationError } from "@/lib/zoho-validation";

const LIST_REVIEW_ACTIONS = [
  "msp_pilot.downstream_automation_review_passed",
  "msp_pilot.downstream_automation_review_blocked"
];

type Client = Prisma.TransactionClient | PrismaClient;

async function loadPlanState(client: Client, planId: string) {
  return client.onboardingPlan.findUnique({
    where: { planId },
    select: {
      assignedSeBookingUrl: true,
      assignedSeEmail: true,
      assignedSeName: true,
      automaticJ1Allowed: true,
      automationEnrollmentState: true,
      automationTaskMappingState: true,
      currentStage: true,
      id: true,
      planId: true,
      kickoffBookedAt: true,
      msp: { select: { name: true, primaryContactEmail: true } },
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: { status: true, templateKey: true, title: true }
      },
      planContacts: {
        where: { role: "ONBOARDING_OWNER" },
        orderBy: { createdAt: "asc" },
        take: 2,
        select: {
          automationEnabled: true,
          email: true,
          firstName: true,
          id: true,
          normalizedEmail: true,
          subscriptionEvidenceReference: true,
          subscriptionStatus: true,
          subscriptionVerifiedBy: true
        }
      },
      status: true,
      zohoLegacyAutomationProtection: { select: { onboardingPlanId: true } }
    }
  });
}

async function loadEvidence(client: Client, onboardingPlanId: string, normalizedEmail: string) {
  const [permission, context, listReview] = await Promise.all([
    client.zohoAutomationAudit.findFirst({
      where: {
        action: "msp_enrollment.contact_permission_recorded",
        actor: { startsWith: "oidc:" },
        evidenceReference: { not: null },
        onboardingPlanId,
        recipientEmailNormalized: normalizedEmail
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true }
    }),
    client.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: normalizedEmail },
      select: { activePlanId: true, state: true }
    }),
    client.zohoAutomationAudit.findFirst({
      where: { action: { in: LIST_REVIEW_ACTIONS } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { action: true }
    })
  ]);
  return { context, listReview, permission };
}

function configurationReadiness() {
  const configuration = getZohoConfigurationStatus();
  const j1 = configuration.journeys.J1;
  return {
    contactConfigurationReady: isEmailAutomationContactConfigurationReady({
      fieldMappingVerified: configuration.fieldMappingVerified,
      listKeyPresent: configuration.listKeyPresent,
      listPrivacyVerified: configuration.listPrivacyVerified,
      oauthConfigured: configuration.oauthConfigured,
      portalBaseUrlPresent: configuration.portalBaseUrlPresent,
      topicId: getZohoTopicId()
    }),
    j1ConfigurationReady: Boolean(
      j1.journeyKeyPresent &&
      j1.triggerKeyPresent &&
      (!isZohoProductionRuntime() || isZohoProductionJourneyEnabled("J1"))
    )
  };
}

async function enablementInput(
  client: Client,
  plan: NonNullable<Awaited<ReturnType<typeof loadPlanState>>>,
  membership: { complete: boolean; statuses: Array<"active" | "unsub" | "bounce"> }
): Promise<EmailAutomationEnablementInput> {
  const owner = plan.planContacts[0] ?? null;
  const evidence = owner ? await loadEvidence(client, plan.id, owner.normalizedEmail) : null;
  const configuration = configurationReadiness();
  return {
    ...configuration,
    contextOwnedByAnotherPlan: Boolean(
      evidence?.context &&
      (evidence.context.state === "BLOCKED" ||
        evidence.context.state === "RELEASE_PENDING" ||
        (evidence.context.activePlanId !== null && evidence.context.activePlanId !== plan.id))
    ),
    j1ConfigurationReady: configuration.j1ConfigurationReady,
    legacyProtected: Boolean(plan.zohoLegacyAutomationProtection),
    listSafetyReviewed: evidence?.listReview?.action === "msp_pilot.downstream_automation_review_passed",
    membershipComplete: membership.complete,
    membershipStatuses: membership.statuses,
    ownerExists: Boolean(owner),
    ownerValid: Boolean(
      owner?.firstName?.trim() &&
      owner &&
      isValidEmailAddress(owner.email) &&
      owner.normalizedEmail === plan.msp.primaryContactEmail.trim().toLowerCase()
    ),
    permissionEvidencePresent: Boolean(evidence?.permission),
    productionRolloutAllowed:
      !isZohoProductionRuntime() || Boolean(owner && plan.planContacts.length === 1 &&
        isZohoProductionRolloutRecipientAllowed({
          planId: plan.planId,
          primaryEmail: plan.msp.primaryContactEmail,
          ownerEmail: owner.email,
          recipientEmail: owner.normalizedEmail
        })),
    salesEngineerDetailsComplete: Boolean(
      plan.assignedSeName?.trim() &&
      plan.assignedSeEmail &&
      isValidEmailAddress(plan.assignedSeEmail) &&
      plan.assignedSeBookingUrl &&
      isValidHttpUrl(plan.assignedSeBookingUrl)
    ),
    subscriptionEvidencePresent: Boolean(
      owner?.subscriptionEvidenceReference?.trim() && owner.subscriptionVerifiedBy?.startsWith("oidc:")
    ),
    subscriptionStatus: owner?.subscriptionStatus ?? null,
    taskMappingVerified: Boolean(
      plan.automationTaskMappingState === "VERIFIED" &&
      plan.onboardingTasks.length > 0 &&
      plan.onboardingTasks.every((task) => Boolean(task.templateKey))
    )
  };
}

function plainEventDescription(event: {
  eventType: "UPSERT_CONTACT" | "TRIGGER_JOURNEY";
  journey: "J1" | "J3_R1" | "J5" | "J8" | null;
  status: string;
}) {
  if (event.eventType === "UPSERT_CONTACT") {
    if (event.status === "SUCCEEDED") return "Contact details synchronized";
    if (event.status === "DEAD") return "Contact synchronization needs attention";
    if (event.status === "CANCELLED") return "Contact update cancelled";
    if (event.status === "HELD") return "Contact update held";
    return "Contact update queued";
  }
  const label = event.journey === "J1"
    ? "Welcome email"
    : event.journey === "J3_R1"
      ? "Next-step reminder"
      : event.journey === "J5"
        ? "Next-step-ready email"
        : "Completion email";
  if (event.status === "SUCCEEDED") return `${label} workflow accepted`;
  if (event.status === "DEAD") return `${label} needs attention`;
  if (event.status === "CANCELLED") return `${label} cancelled`;
  if (event.status === "HELD") return `${label} held`;
  return `${label} queued`;
}

export async function getZohoEmailAutomationStatus(
  planId: string,
  options: { canManage?: boolean } = {}
) {
  const plan = await loadPlanState(prisma, planId);
  if (!plan) return null;
  const owner = plan.planContacts[0] ?? null;
  const [input, events, lastJourney, actionAudits] = await Promise.all([
    enablementInput(prisma, plan, { complete: true, statuses: [] }),
    prisma.zohoOutboxEvent.findMany({
      where: { onboardingPlanId: plan.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        attemptCount: true,
        createdAt: true,
        eventType: true,
        journey: true,
        lastProviderOutcome: true,
        status: true,
        updatedAt: true
      }
    }),
    prisma.zohoJourneySend.findFirst({
      where: { onboardingPlanId: plan.id, attemptedAt: { not: null } },
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
      select: { attemptedAt: true, journey: true, providerResult: true, succeededAt: true }
    }),
    prisma.zohoAutomationAudit.findMany({
      where: {
        action: { in: ["email_automation.enabled", "email_automation.disabled"] },
        onboardingPlanId: plan.id
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
      select: { action: true, createdAt: true }
    })
  ]);
  const readiness = evaluateEmailAutomationEnablement(input);
  const dispatch = getZohoDispatchConfiguration();
  const enabled = plan.automationEnrollmentState === "ACTIVE" && owner?.automationEnabled === true;
  const { held: heldJourney, scheduled: scheduledJourney } = selectKZeroEmailSchedule(events);
  const lastContact = events.find((event) => event.eventType === "UPSERT_CONTACT") ?? null;
  const systemSendingActive = Boolean(
    !dispatch.globalKillSwitch &&
    dispatch.mode === "production" &&
    dispatch.contactSyncEnabled &&
    dispatch.journeyTriggeringEnabled &&
    dispatch.automaticDispatchEnabled &&
    dispatch.productionApproved
  );
  const history = [
    ...events.map((event) => ({
      at: event.updatedAt,
      detail: event.status === "SUCCEEDED"
        ? "Accepted by the configured provider workflow; delivery is not independently confirmed."
        : event.status === "HELD"
          ? "Waiting for a safety or eligibility requirement."
          : event.status === "RETRY"
            ? event.lastProviderOutcome === "ACCEPTED_PENDING_VERIFICATION"
              ? "Zoho accepted the contact update; KZero is waiting for read-only membership verification."
              : "A recoverable provider error will be retried safely."
            : null,
      label: plainEventDescription(event),
      state: event.status
    })),
    ...actionAudits.map((audit) => ({
      at: audit.createdAt,
      detail: null,
      label: audit.action === "email_automation.enabled" ? "Automated emails enabled" : "Automated emails disabled",
      state: audit.action.endsWith("enabled") ? "ENABLED" : "DISABLED"
    }))
  ].sort((left, right) => right.at.getTime() - left.at.getTime()).slice(0, 10);

  return {
    activity: history,
    automation: {
      enabled,
      systemSendingActive,
      systemState: systemSendingActive ? "ACTIVE" : "PAUSED_BY_SYSTEM"
    },
    blockers: readiness.blockers,
    canManage: options.canManage === true,
    contact: {
      attempts: lastContact?.attemptCount ?? 0,
      email: owner?.email ?? plan.msp.primaryContactEmail,
      lastStatus: lastContact?.status ?? "NOT_STARTED",
      providerOutcome: lastContact?.lastProviderOutcome ?? null
    },
    currentStage: plan.currentStage || plan.onboardingTasks.find((task) => task.status !== "complete")?.title || "Not set",
    lastEmail: lastJourney ? {
      at: lastJourney.succeededAt ?? lastJourney.attemptedAt,
      journey: lastJourney.journey,
      status: lastJourney.providerResult,
      verifiedDelivered: false
    } : null,
    mspName: plan.msp.name,
    heldEmail: heldJourney ? {
      journey: heldJourney.journey,
      message: "KZero email work is held and will not send until separately reviewed."
    } : null,
    nextEmail: scheduledJourney ? {
      journey: scheduledJourney.journey,
      state: scheduledJourney.status,
      timing: lastContact?.status !== "SUCCEEDED" || lastContact.lastProviderOutcome !== "VERIFIED"
        ? "Waiting for contact synchronization and verification"
        : !systemSendingActive
          ? "Ready when system sending is approved"
          : scheduledJourney.status === "PENDING"
            ? "Queued for automatic processing"
            : "Retry waiting for a safe provider window"
    } : null,
    planId,
    warning: enabled && !systemSendingActive
      ? "Automated emails are enabled for this MSP, but sending is paused by KZero's system-wide safety controls."
      : null
  };
}

export async function enableZohoEmailAutomation(
  input: { actor: string; planId: string },
  dependencies: {
    client?: PrismaClient;
    membershipCheck?: typeof checkZohoListMembership;
  } = {}
) {
  const client = dependencies.client ?? prisma;
  const membershipCheck = dependencies.membershipCheck ?? checkZohoListMembership;
  const initial = await loadPlanState(client, input.planId);
  if (!initial) throw new ZohoAdminValidationError("This onboarding case could not be found.", 404);
  const initialOwner = initial.planContacts[0];
  if (!initialOwner) throw new ZohoAdminValidationError("Add an Onboarding Owner before enabling automated emails.", 409);

  const preliminary = evaluateEmailAutomationEnablement(
    await enablementInput(client, initial, { complete: true, statuses: [] })
  );
  const nonMembershipBlockers = preliminary.blockers.filter(
    (blocker) => !["RECIPIENT_SUPPRESSED", "SUPPRESSION_CHECK_INCOMPLETE"].includes(blocker.code)
  );
  if (nonMembershipBlockers.length) {
    throw new ZohoAdminValidationError(nonMembershipBlockers[0].action, 409);
  }

  let membership: Awaited<ReturnType<typeof checkZohoListMembership>>;
  try {
    membership = await membershipCheck(initialOwner.email);
  } catch {
    throw new ZohoAdminValidationError(
      "Zoho suppression status could not be verified. No automation was enabled; try again later.",
      503
    );
  }

  await client.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-email-automation:${initial.id}`}, 0))
    `);
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${initialOwner.normalizedEmail}`}, 0))
    `);
    const plan = await loadPlanState(transaction, input.planId);
    if (!plan || !plan.planContacts[0]) {
      throw new ZohoAdminValidationError("The onboarding case changed. Reload it before trying again.", 409);
    }
    const owner = plan.planContacts[0];
    if (owner.id !== initialOwner.id || owner.normalizedEmail !== initialOwner.normalizedEmail) {
      throw new ZohoAdminValidationError("The Onboarding Owner changed. Review authorization before enabling automated emails.", 409);
    }
    if (plan.automationEnrollmentState === "ACTIVE" && owner.automationEnabled) return;
    const decision = evaluateEmailAutomationEnablement(await enablementInput(transaction, plan, {
      complete: !membership.truncated,
      statuses: membership.listStatuses
    }));
    if (!decision.ready) throw new ZohoAdminValidationError(decision.blockers[0].action, 409);

    const context = await transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: owner.normalizedEmail }
    });
    const now = new Date();
    if (!context) {
      await transaction.zohoCommunicationContext.create({
        data: {
          acquiredAt: now,
          acquiredBy: input.actor,
          acquisitionReason: "Automated emails enabled for this onboarding case.",
          activePlanId: plan.id,
          recipientEmailNormalized: owner.normalizedEmail,
          state: "ACTIVE"
        }
      });
    } else if (context.state === "UNASSIGNED" && context.activePlanId === null && !context.processingClaimId) {
      await transaction.zohoCommunicationContext.update({
        where: { recipientEmailNormalized: owner.normalizedEmail },
        data: {
          acquiredAt: now,
          acquiredBy: input.actor,
          acquisitionReason: "Automated emails enabled for this onboarding case.",
          activePlanId: plan.id,
          state: "ACTIVE",
          version: { increment: 1 }
        }
      });
    } else if (context.state !== "ACTIVE" || context.activePlanId !== plan.id) {
      throw new ZohoAdminValidationError("This email address belongs to another active onboarding case.", 409);
    }

    await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: {
        automaticJ1Allowed: true,
        automationEnrolledAt: now,
        automationEnrolledBy: input.actor,
        automationEnrollmentState: "ACTIVE"
      }
    });
    await transaction.planContact.update({ where: { id: owner.id }, data: { automationEnabled: true } });
    const audit = await createZohoAutomationAuditInTransaction(transaction, {
      action: "email_automation.enabled",
      actor: input.actor,
      evidenceReference: owner.id,
      onboardingPlanId: plan.id,
      reason: "Automated emails were enabled for this MSP after consent, subscription, suppression, provider, task, and communication-context checks passed.",
      recipientEmail: owner.email
    });
    const prepared = await prepareZohoEmailAutomationEventsInTransaction(transaction, {
      onboardingPlanId: plan.id,
      occurrenceKey: `automation-enabled:${audit.id}`
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "email_automation.work_prepared",
      actor: input.actor,
      onboardingPlanId: plan.id,
      reason: `Durable contact-first work prepared. contact=${prepared.contactPrepared}; j1=${prepared.j1Prepared}; no provider request was made by this administrative action.`,
      recipientEmail: owner.email
    });
  });
}

export async function disableZohoEmailAutomation(
  input: { actor: string; planId: string },
  dependencies: { client?: PrismaClient } = {}
) {
  const client = dependencies.client ?? prisma;
  await client.$transaction(async (transaction) => {
    const plan = await loadPlanState(transaction, input.planId);
    if (!plan) throw new ZohoAdminValidationError("This onboarding case could not be found.", 404);
    const owner = plan.planContacts[0];
    if (!owner) throw new ZohoAdminValidationError("The Onboarding Owner could not be found.", 409);
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-email-automation:${plan.id}`}, 0))
    `);
    if (plan.zohoLegacyAutomationProtection) {
      throw new ZohoAdminValidationError("This historical plan is already permanently excluded from automated emails.", 409);
    }
    if (plan.automationEnrollmentState !== "ACTIVE" && !owner.automationEnabled) return;

    await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: { automaticJ1Allowed: false, automationEnrollmentState: "PAUSED", nudgeStatus: "DONE" }
    });
    await transaction.planContact.update({ where: { id: owner.id }, data: { automationEnabled: false } });
    await transaction.zohoOutboxEvent.updateMany({
      where: { onboardingPlanId: plan.id, status: { in: ["PENDING", "HELD", "RETRY"] } },
      data: {
        holdReason: "AUTOMATED_EMAILS_DISABLED_BY_ADMIN",
        nextAttemptAt: null,
        status: "CANCELLED"
      }
    });
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "email_automation.disabled",
      actor: input.actor,
      onboardingPlanId: plan.id,
      reason: "Automated emails were disabled and all unclaimed queued work for this plan was cancelled. Already active provider journeys require independent exit verification.",
      recipientEmail: owner.email
    });
  });
}
