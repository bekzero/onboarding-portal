import "server-only";

import type {
  PlanContactRole,
  Prisma,
  SubscriptionEligibilityStatus,
  ZohoJourneyType,
  ZohoOutboxEventStatus
} from "@prisma/client";
import {
  createStableZohoKey,
  createZohoAutomationAuditInTransaction,
  createZohoContactSyncEventInTransaction,
  createZohoJourneyTriggerEventInTransaction,
  isZohoEventEmissionEnabled,
  type ZohoTransaction
} from "@/lib/zoho-foundation";
import { getPersistedZohoContactSnapshotWithClient } from "@/lib/zoho-contact-snapshot";
import { getZohoTestJ1EnrollmentConfiguration } from "@/lib/zoho-config";
import { getZohoAutomationReadinessWithClient } from "@/lib/zoho-readiness";
import { classifyZohoEventDisposition } from "@/lib/zoho-lifecycle-rules";

export {
  didActiveTaskChange,
  isApprovedJ8Transition,
  isQualifyingKzeroHandoff,
  shouldFinishNudge
} from "@/lib/zoho-lifecycle-rules";

type ContactRecipient = {
  automationEnabled: boolean;
  email: string;
  id: string;
  normalizedEmail: string;
  role: PlanContactRole;
  subscriptionStatus: SubscriptionEligibilityStatus;
};

type SyncInput = {
  allowStopState?: boolean;
  isStopState?: boolean;
  occurrenceKey: string;
  onboardingPlanId: string;
  reason: string;
  recipientRoles?: PlanContactRole[];
  taskKey?: string | null;
};

type JourneyInput = SyncInput & {
  eventMetadata?: Record<string, string>;
  handoffKey?: string;
  journey: ZohoJourneyType;
  marketingApprovalRequired?: boolean;
};

function sanitizeReason(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Snapshot validation failed.";
}

async function getActivePlanAndRecipients(
  transaction: ZohoTransaction,
  onboardingPlanId: string,
  roles: PlanContactRole[],
  allowStopState = false
) {
  const plan = await transaction.onboardingPlan.findUnique({
    where: { id: onboardingPlanId },
    select: {
      automationEnrollmentState: true,
      id: true,
      planId: true,
      planContacts: {
        where: { automationEnabled: true, role: { in: roles } },
        select: {
          automationEnabled: true,
          email: true,
          id: true,
          normalizedEmail: true,
          role: true,
          subscriptionStatus: true
        }
      }
    }
  });

  if (
    !plan ||
    (plan.automationEnrollmentState !== "ACTIVE" &&
      !(allowStopState && ["PAUSED", "COMPLETE"].includes(plan.automationEnrollmentState)))
  ) return null;
  return { ...plan, recipients: plan.planContacts };
}

async function getEventDisposition(
  transaction: ZohoTransaction,
  planId: string,
  recipient: ContactRecipient,
  journey: boolean,
  marketingApprovalRequired = false
): Promise<{ holdReason?: string; status: ZohoOutboxEventStatus }> {
  const context = await transaction.zohoCommunicationContext.findUnique({
    where: { recipientEmailNormalized: recipient.normalizedEmail }
  });

  return classifyZohoEventDisposition({
    activePlanId: context?.activePlanId ?? null,
    contextState: context?.state ?? null,
    journey,
    marketingApprovalRequired,
    planId,
    subscriptionStatus: recipient.subscriptionStatus
  });
}

async function buildImmutablePayload(
  transaction: ZohoTransaction,
  planId: string,
  contactId: string,
  event: {
    metadata?: Record<string, string>;
    occurrenceKey: string;
    reason: string;
    taskKey?: string | null;
  }
): Promise<{ holdReason?: string; payload: Prisma.InputJsonValue }> {
  try {
    const { snapshot } = await getPersistedZohoContactSnapshotWithClient(
      transaction,
      planId,
      contactId
    );
    return {
      payload: {
        schemaVersion: 2,
        event: {
          occurrenceKey: event.occurrenceKey,
          reason: event.reason,
          taskKey: event.taskKey ?? null,
          ...(event.metadata ?? {})
        },
        revalidateBeforeDispatch: true,
        snapshot
      }
    };
  } catch (error) {
    return {
      holdReason: "SNAPSHOT_VALIDATION_FAILED",
      payload: {
        schemaVersion: 2,
        event: {
          occurrenceKey: event.occurrenceKey,
          reason: event.reason,
          taskKey: event.taskKey ?? null,
          ...(event.metadata ?? {})
        },
        revalidateBeforeDispatch: true,
        snapshotError: sanitizeReason(error)
      }
    };
  }
}

async function recordZohoContactSyncEvents(
  transaction: ZohoTransaction,
  input: SyncInput,
  emissionAuthorized: boolean
) {
  if (!emissionAuthorized) return [];
  const roles = input.recipientRoles ?? ["ONBOARDING_OWNER"];
  const plan = await getActivePlanAndRecipients(
    transaction,
    input.onboardingPlanId,
    roles,
    input.allowStopState
  );
  if (!plan) return [];

  const results = [];
  for (const recipient of plan.recipients) {
    const disposition = await getEventDisposition(transaction, plan.id, recipient, false);
    const snapshot = await buildImmutablePayload(transaction, plan.planId, recipient.id, input);
    const holdReason = snapshot.holdReason ?? disposition.holdReason;
    results.push(
      await createZohoContactSyncEventInTransaction(transaction, {
        eventKey: createStableZohoKey(
          "contact-sync",
          input.occurrenceKey,
          plan.planId,
          recipient.normalizedEmail
        ),
        holdReason,
        isStopState: input.isStopState ?? false,
        onboardingPlanId: plan.id,
        payload: snapshot.payload,
        recipientEmail: recipient.email,
        status: holdReason ? "HELD" : disposition.status,
        taskKey: input.taskKey ?? undefined
      })
    );
  }
  return results;
}

export function recordZohoContactSyncEventsInTransaction(
  transaction: ZohoTransaction,
  input: SyncInput
) {
  return recordZohoContactSyncEvents(transaction, input, isZohoEventEmissionEnabled());
}

async function recordZohoJourneyEvents(
  transaction: ZohoTransaction,
  input: JourneyInput,
  emissionAuthorized: boolean
) {
  if (!emissionAuthorized) return [];
  const roles = input.recipientRoles ?? ["ONBOARDING_OWNER"];
  const plan = await getActivePlanAndRecipients(transaction, input.onboardingPlanId, roles);
  if (!plan) return [];

  const results = [];
  for (const recipient of plan.recipients) {
    const disposition = await getEventDisposition(
      transaction,
      plan.id,
      recipient,
      true,
      input.marketingApprovalRequired
    );
    const snapshot = await buildImmutablePayload(transaction, plan.planId, recipient.id, {
      ...input,
      metadata: input.eventMetadata
    });
    const holdReason = snapshot.holdReason ?? disposition.holdReason;
    const dedupeKey = createStableZohoKey(
      "journey",
      input.journey,
      input.handoffKey ?? input.taskKey ?? "plan",
      plan.planId,
      recipient.normalizedEmail
    );
    results.push(
      await createZohoJourneyTriggerEventInTransaction(transaction, {
        dedupeKey,
        eventKey: createStableZohoKey("trigger", input.occurrenceKey, dedupeKey),
        handoffKey: input.handoffKey,
        holdReason,
        journey: input.journey,
        onboardingPlanId: plan.id,
        payload: snapshot.payload,
        recipientEmail: recipient.email,
        status: holdReason ? "HELD" : disposition.status,
        taskKey: input.taskKey ?? undefined
      })
    );
  }
  return results;
}

export function recordZohoJourneyEventsInTransaction(
  transaction: ZohoTransaction,
  input: JourneyInput
) {
  return recordZohoJourneyEvents(transaction, input, isZohoEventEmissionEnabled());
}

export async function recordAllowlistedZohoTestJ1EnrollmentInTransaction(
  transaction: ZohoTransaction,
  input: { actor: string; onboardingPlanId: string }
) {
  const config = getZohoTestJ1EnrollmentConfiguration();
  const plan = await transaction.onboardingPlan.findUnique({
    where: { id: input.onboardingPlanId },
    select: {
      automaticJ1Allowed: true,
      automationEnrollmentState: true,
      id: true,
      kickoffBookedAt: true,
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: { status: true, templateKey: true }
      },
      planContacts: {
        where: { role: "ONBOARDING_OWNER" },
        take: 1,
        select: {
          automationEnabled: true,
          email: true,
          id: true,
          normalizedEmail: true,
          subscriptionStatus: true
        }
      },
      planId: true
    }
  });
  const owner = plan?.planContacts[0];
  if (!plan || !owner) throw new Error("The allowlisted TEST J1 plan and Onboarding Owner are required.");

  const exactTarget =
    config.targetConfigured &&
    config.allowedPlanIds.size === 1 &&
    config.allowedEmails.size === 1 &&
    config.allowedPlanIds.has(plan.planId) &&
    config.allowedEmails.has(owner.normalizedEmail);
  if (!config.enabled || !config.dispatchModeIsTest || !exactTarget) {
    throw new Error("The exact TEST J1 plan and recipient are not safely allowlisted.");
  }
  if (
    !config.globalKillSwitchEnabled ||
    !config.automaticDispatchDisabled ||
    !config.productionDispatchDisabled
  ) {
    throw new Error("TEST J1 intent preparation requires the global kill switch and disabled automatic production dispatch.");
  }
  if (
    !config.listConfigured ||
    !config.topicIdValid ||
    !config.fieldMappingVerified ||
    !config.listPrivacyVerified ||
    !config.testJ1Configured
  ) {
    throw new Error("TEST J1 list, numeric topic, verified fields/private list, and distinct journey keys are required.");
  }
  if (
    plan.automationEnrollmentState !== "ACTIVE" ||
    !plan.automaticJ1Allowed ||
    !owner.automationEnabled ||
    owner.subscriptionStatus === "INELIGIBLE"
  ) {
    throw new Error("The allowlisted TEST J1 plan and owner are not automation eligible.");
  }
  const initialTask = plan.onboardingTasks.find((task) => task.status !== "complete");
  if (
    initialTask?.templateKey !== "book-kickoff" ||
    initialTask.status !== "waiting_on_msp" ||
    plan.kickoffBookedAt
  ) {
    throw new Error("TEST J1 requires the initial kickoff-booking task to be waiting on the MSP.");
  }
  const [context, permission] = await Promise.all([
    transaction.zohoCommunicationContext.findUnique({
      where: { recipientEmailNormalized: owner.normalizedEmail },
      select: { activePlanId: true, state: true }
    }),
    transaction.zohoAutomationAudit.findFirst({
      where: {
        action: "msp_enrollment.contact_permission_recorded",
        actor: { startsWith: "oidc:" },
        evidenceReference: { not: null },
        onboardingPlanId: plan.id,
        recipientEmailNormalized: owner.normalizedEmail
      },
      select: { id: true }
    })
  ]);
  if (context?.state !== "ACTIVE" || context.activePlanId !== plan.id || !permission) {
    throw new Error("An attributable permission record and active communication context are required.");
  }
  await getPersistedZohoContactSnapshotWithClient(transaction, plan.planId, owner.id);

  const contactEvents = await recordZohoContactSyncEvents(transaction, {
    occurrenceKey: `plan-created:${plan.planId}`,
    onboardingPlanId: plan.id,
    reason: "plan.created.test-j1",
    taskKey: initialTask.templateKey
  }, true);
  const journeyEvents = await recordZohoJourneyEvents(transaction, {
    eventMetadata: {
      testJ1KeyFingerprint: config.j1KeyFingerprint ?? "",
      testJ1SelectionMode: config.j1SelectionMode
    },
    journey: "J1",
    occurrenceKey: `plan-created-j1:${plan.planId}`,
    onboardingPlanId: plan.id,
    reason: "plan.created.test-j1",
    taskKey: initialTask.templateKey
  }, true);
  await createZohoAutomationAuditInTransaction(transaction, {
    action: "test_j1.enrollment_intents_prepared",
    actor: input.actor,
    onboardingPlanId: plan.id,
    reason: "Allowlisted full-field contact and held TEST J1 intents were prepared. No provider request was made.",
    recipientEmail: owner.email
  });
  return {
    contactCreated: contactEvents.some((event) => event.created),
    journeyCreated: journeyEvents.some((event) => event.created),
    journeyHeldForSubscription: owner.subscriptionStatus !== "CONFIRMED"
  };
}

export async function recordAutomationNotReadyAuditInTransaction(
  transaction: ZohoTransaction,
  input: { onboardingPlanId: string; reasonCodes: string[] }
) {
  if (!isZohoEventEmissionEnabled()) return;
  await createZohoAutomationAuditInTransaction(transaction, {
    action: "plan_created.automation_not_ready",
    actor: "system",
    onboardingPlanId: input.onboardingPlanId,
    reason: input.reasonCodes.length
      ? `Plan creation did not qualify for automation: ${input.reasonCodes.join(", ")}.`
      : "Plan creation did not qualify for automation."
  });
}

export async function recordZohoPlanCreatedEventsInTransaction(
  transaction: ZohoTransaction,
  onboardingPlanId: string
) {
  if (!isZohoEventEmissionEnabled()) return { created: false, reasonCodes: [] as string[] };
  const plan = await transaction.onboardingPlan.findUnique({
    where: { id: onboardingPlanId },
    select: {
      automaticJ1Allowed: true,
      id: true,
      kickoffBookedAt: true,
      onboardingTasks: {
        orderBy: { order: "asc" },
        select: { status: true, templateKey: true }
      },
      planId: true
    }
  });
  if (!plan) return { created: false, reasonCodes: ["PLAN_NOT_FOUND"] };

  const readiness = await getZohoAutomationReadinessWithClient(transaction, plan.planId);
  const reasonCodes = readiness?.reasons.map((reason) => reason.code) ?? ["PLAN_NOT_FOUND"];
  const initialTask = plan.onboardingTasks.find((task) => task.status !== "complete");
  const initialJ1StateValid =
    initialTask?.templateKey === "book-kickoff" &&
    initialTask.status === "waiting_on_msp" &&
    !plan.kickoffBookedAt;

  if (!readiness?.readyForDataSync) return { created: false, reasonCodes };
  await recordZohoContactSyncEventsInTransaction(transaction, {
    occurrenceKey: `plan-created:${plan.planId}`,
    onboardingPlanId: plan.id,
    reason: "plan.created",
    taskKey: initialTask?.templateKey
  });
  if (!readiness.readyForJourneyEnrollment || !plan.automaticJ1Allowed || !initialJ1StateValid) {
    return {
      created: false,
      reasonCodes: initialJ1StateValid ? reasonCodes : [...reasonCodes, "J1_INITIAL_STATE_INVALID"]
    };
  }
  await recordZohoJourneyEventsInTransaction(transaction, {
    journey: "J1",
    occurrenceKey: `plan-created-j1:${plan.planId}`,
    onboardingPlanId: plan.id,
    reason: "plan.created.j1",
    taskKey: initialTask.templateKey
  });
  return { created: true, reasonCodes: [] as string[] };
}
