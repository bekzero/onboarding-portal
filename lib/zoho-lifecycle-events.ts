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
  event: { occurrenceKey: string; reason: string; taskKey?: string | null }
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
          taskKey: event.taskKey ?? null
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
          taskKey: event.taskKey ?? null
        },
        revalidateBeforeDispatch: true,
        snapshotError: sanitizeReason(error)
      }
    };
  }
}

export async function recordZohoContactSyncEventsInTransaction(
  transaction: ZohoTransaction,
  input: SyncInput
) {
  if (!isZohoEventEmissionEnabled()) return [];
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

export async function recordZohoJourneyEventsInTransaction(
  transaction: ZohoTransaction,
  input: JourneyInput
) {
  if (!isZohoEventEmissionEnabled()) return [];
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
    const snapshot = await buildImmutablePayload(transaction, plan.planId, recipient.id, input);
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
