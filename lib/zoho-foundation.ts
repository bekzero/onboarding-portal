import "server-only";
import {
  Prisma,
  type ZohoJourneyType,
  type ZohoOutboxEventStatus,
  type ZohoOutboxEventType
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ZohoTransaction = Prisma.TransactionClient;

export function normalizeZohoRecipientEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("A recipient email is required.");
  }

  return normalizedEmail;
}

export function isZohoDispatchEnabled() {
  return process.env.ZOHO_DISPATCH_ENABLED?.trim().toLowerCase() === "true";
}

export function isZohoEventEmissionEnabled() {
  return process.env.ZOHO_EVENT_EMISSION_ENABLED?.trim().toLowerCase() === "true";
}

export function createStableZohoKey(...parts: Array<string | number>) {
  return parts.map((part) => encodeURIComponent(String(part).trim().toLowerCase())).join(":");
}

type CreateZohoOutboxEventInput = {
  eventKey: string;
  eventType: ZohoOutboxEventType;
  handoffKey?: string;
  journey?: ZohoJourneyType;
  onboardingPlanId: string;
  payload: Prisma.InputJsonValue;
  recipientEmail: string;
  status?: ZohoOutboxEventStatus;
  holdReason?: string;
  taskKey?: string;
  isStopState?: boolean;
};

type CreateZohoAuditInput = {
  action: string;
  actor: string;
  evidenceReference?: string;
  onboardingPlanId?: string;
  planId?: string;
  reason: string;
  recipientEmail?: string;
};

type CreateJourneyTriggerInput = Omit<CreateZohoOutboxEventInput, "eventType"> & {
  dedupeKey: string;
  journey: ZohoJourneyType;
};

async function lockStableKey(transaction: ZohoTransaction, stableKey: string) {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${stableKey}, 0))
  `);
}

export async function allocateZohoRecipientSequence(
  transaction: ZohoTransaction,
  recipientEmail: string
) {
  const recipientEmailNormalized = normalizeZohoRecipientEmail(recipientEmail);
  const allocated = await transaction.$queryRaw<Array<{ sequence: bigint }>>(Prisma.sql`
    INSERT INTO "zoho_recipient_sequences" (
      "recipientEmailNormalized",
      "nextSequence",
      "createdAt",
      "updatedAt"
    )
    VALUES (${recipientEmailNormalized}, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("recipientEmailNormalized") DO UPDATE
    SET
      "nextSequence" = "zoho_recipient_sequences"."nextSequence" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextSequence" - 1 AS "sequence"
  `);
  const sequence = allocated[0]?.sequence;

  if (sequence === undefined) {
    throw new Error("Could not allocate a Zoho outbox sequence.");
  }

  return { recipientEmailNormalized, sequence };
}

export async function createZohoOutboxEventInTransaction(
  transaction: ZohoTransaction,
  input: CreateZohoOutboxEventInput
) {
  await lockStableKey(transaction, `zoho-event:${input.eventKey}`);

  const existingEvent = await transaction.zohoOutboxEvent.findUnique({
    where: { eventKey: input.eventKey }
  });
  if (existingEvent) {
    return { created: false, event: existingEvent };
  }

  const plan = await transaction.onboardingPlan.findUnique({
    where: { id: input.onboardingPlanId },
    select: { automationEnrollmentState: true, planId: true }
  });
  if (!plan) {
    throw new Error("The onboarding plan could not be found.");
  }
  if (plan.automationEnrollmentState === "EXCLUDED") {
    throw new Error("Automation events cannot be created for an excluded plan.");
  }

  const { recipientEmailNormalized, sequence } = await allocateZohoRecipientSequence(
    transaction,
    input.recipientEmail
  );
  const event = await transaction.zohoOutboxEvent.create({
    data: {
      eventKey: input.eventKey,
      eventType: input.eventType,
      handoffKey: input.handoffKey,
      isStopState: input.isStopState ?? false,
      journey: input.journey,
      onboardingPlanId: input.onboardingPlanId,
      payload: input.payload,
      planId: plan.planId,
      recipientEmailNormalized,
      sequence,
      status: input.status,
      holdReason: input.holdReason?.trim() || null,
      taskKey: input.taskKey
    }
  });

  return { created: true, event };
}

export function createZohoContactSyncEventInTransaction(
  transaction: ZohoTransaction,
  input: Omit<CreateZohoOutboxEventInput, "eventType" | "journey">
) {
  return createZohoOutboxEventInTransaction(transaction, {
    ...input,
    eventType: "UPSERT_CONTACT"
  });
}

export async function createZohoJourneyTriggerEventInTransaction(
  transaction: ZohoTransaction,
  input: CreateJourneyTriggerInput
) {
  await lockStableKey(transaction, `zoho-journey:${input.dedupeKey}`);

  const plan = await transaction.onboardingPlan.findUnique({
    where: { id: input.onboardingPlanId },
    select: { automationEnrollmentState: true, planId: true }
  });
  if (!plan) {
    throw new Error("The onboarding plan could not be found.");
  }
  if (plan.automationEnrollmentState === "EXCLUDED") {
    throw new Error("Journey events cannot be created for an excluded plan.");
  }

  const recipientEmailNormalized = normalizeZohoRecipientEmail(input.recipientEmail);
  const existingSend = await transaction.zohoJourneySend.findUnique({
    where: { dedupeKey: input.dedupeKey }
  });
  if (existingSend) {
    const existingEvent = await transaction.zohoOutboxEvent.findUnique({
      where: { eventKey: input.eventKey }
    });
    return { created: false, event: existingEvent, journeySend: existingSend };
  }

  const journeySend = await transaction.zohoJourneySend.create({
    data: {
      dedupeKey: input.dedupeKey,
      handoffKey: input.handoffKey,
      journey: input.journey,
      onboardingPlanId: input.onboardingPlanId,
      planId: plan.planId,
      recipientEmailNormalized,
      taskKey: input.taskKey
    }
  });
  const eventResult = await createZohoOutboxEventInTransaction(transaction, {
    ...input,
    eventType: "TRIGGER_JOURNEY"
  });

  return { ...eventResult, journeySend };
}

export async function createZohoAutomationAuditInTransaction(
  transaction: ZohoTransaction,
  input: CreateZohoAuditInput
) {
  const plan = input.onboardingPlanId
    ? await transaction.onboardingPlan.findUnique({
        where: { id: input.onboardingPlanId },
        select: { planId: true }
      })
    : null;

  return transaction.zohoAutomationAudit.create({
    data: {
      action: input.action.trim(),
      actor: input.actor.trim(),
      evidenceReference: input.evidenceReference?.trim() || null,
      onboardingPlanId: input.onboardingPlanId,
      planId: input.planId?.trim() || plan?.planId || null,
      reason: input.reason.trim(),
      recipientEmailNormalized: input.recipientEmail
        ? normalizeZohoRecipientEmail(input.recipientEmail)
        : null
    }
  });
}

// Convenience wrapper for callers that do not already own a business-state
// transaction. State-changing services should call the transaction variant.
export function createZohoOutboxEvent(input: CreateZohoOutboxEventInput) {
  return prisma.$transaction((transaction) =>
    createZohoOutboxEventInTransaction(transaction, input)
  );
}
