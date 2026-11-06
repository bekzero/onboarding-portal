import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getZonedBusinessDate,
  isBusinessDay,
  isTorontoDailyNudgeWindow,
  ZOHO_NUDGE_TIMEZONE
} from "@/lib/zoho-business-days";
import { getZohoNudgeConfiguration } from "@/lib/zoho-config";
import {
  createStableZohoKey,
  createZohoAutomationAuditInTransaction,
  isZohoEventEmissionEnabled,
  type ZohoTransaction
} from "@/lib/zoho-foundation";
import {
  recordZohoContactSyncEventsInTransaction,
  recordZohoJourneyEventsInTransaction
} from "@/lib/zoho-lifecycle-events";
import { evaluateZohoNudgeEligibility, type ZohoNudgeRuleInput } from "@/lib/zoho-nudge-rules";

type NudgeClient = ZohoTransaction | PrismaClient;
type Decision = ReturnType<typeof evaluateZohoNudgeEligibility>;

const planSelect = {
  id: true,
  planId: true,
  customerName: true,
  currentStage: true,
  status: true,
  automationEnrollmentState: true,
  automationOrigin: true,
  automationTaskMappingState: true,
  nextTaskSince: true,
  nudgeStartedAt: true,
  nudgeStatus: true,
  nudgeTaskKey: true,
  msp: { select: { name: true } },
  onboardingTasks: {
    orderBy: { order: "asc" as const },
    select: { owner: true, status: true, templateKey: true, title: true }
  },
  planContacts: {
    where: { role: "ONBOARDING_OWNER" as const },
    orderBy: { createdAt: "asc" as const },
    select: {
      automationEnabled: true,
      email: true,
      id: true,
      normalizedEmail: true,
      subscriptionStatus: true
    }
  },
  zohoJourneySends: {
    where: { journey: "J3_R1" as const },
    orderBy: { createdAt: "desc" as const },
    select: {
      attemptedAt: true,
      providerResult: true,
      recipientEmailNormalized: true,
      taskKey: true,
      updatedAt: true
    }
  }
} satisfies Prisma.OnboardingPlanSelect;

type NudgePlan = Prisma.OnboardingPlanGetPayload<{ select: typeof planSelect }>;

async function loadContextFacts(client: NudgeClient, plans: NudgePlan[]) {
  const emails = [...new Set(plans.flatMap((plan) => plan.planContacts.map((contact) => contact.normalizedEmail)))];
  const [contexts, competing] = await Promise.all([
    client.zohoCommunicationContext.findMany({
      where: { recipientEmailNormalized: { in: emails } },
      select: { activePlanId: true, recipientEmailNormalized: true, state: true }
    }),
    client.planContact.findMany({
      where: {
        normalizedEmail: { in: emails },
        automationEnabled: true,
        onboardingPlan: { automationEnrollmentState: "ACTIVE" }
      },
      select: { normalizedEmail: true, onboardingPlanId: true }
    })
  ]);
  const contextByEmail = new Map(contexts.map((context) => [context.recipientEmailNormalized, context]));
  const activePlansByEmail = new Map<string, Set<string>>();
  for (const contact of competing) {
    const set = activePlansByEmail.get(contact.normalizedEmail) ?? new Set<string>();
    set.add(contact.onboardingPlanId);
    activePlansByEmail.set(contact.normalizedEmail, set);
  }
  return { activePlansByEmail, contextByEmail };
}

function decide(plan: NudgePlan, facts: Awaited<ReturnType<typeof loadContextFacts>>, evaluationAt: Date) {
  const currentTask = plan.onboardingTasks.find((task) => task.status !== "complete") ?? null;
  const owner = plan.planContacts[0] ?? null;
  const context = owner ? facts.contextByEmail.get(owner.normalizedEmail) : null;
  const prior = owner && currentTask?.templateKey
    ? plan.zohoJourneySends.find(
        (send) => send.taskKey === currentTask.templateKey && send.recipientEmailNormalized === owner.normalizedEmail
      )
    : undefined;
  const activePlans = owner ? facts.activePlansByEmail.get(owner.normalizedEmail) : undefined;
  const ruleInput: ZohoNudgeRuleInput = {
    automationEnrollmentState: plan.automationEnrollmentState,
    automationOrigin: plan.automationOrigin,
    automationTaskMappingState: plan.automationTaskMappingState,
    competingActivePlanCount: activePlans
      ? [...activePlans].filter((planId) => planId !== plan.id).length
      : 0,
    contextActivePlanId: context?.activePlanId ?? null,
    contextState: context?.state ?? null,
    currentStage: plan.currentStage,
    currentTask,
    evaluationAt,
    hasPriorJ3: Boolean(prior),
    nextTaskSince: plan.nextTaskSince,
    nudgeStartedAt: plan.nudgeStartedAt,
    nudgeStatus: plan.nudgeStatus,
    onboardingPlanId: plan.id,
    owner,
    planStatus: plan.status,
    priorJ3Attempted: Boolean(prior?.attemptedAt),
    priorJ3Result: prior?.providerResult ?? null
  };
  return { currentTask, decision: evaluateZohoNudgeEligibility(ruleInput), owner, prior };
}

function previewRow(plan: NudgePlan, evaluated: ReturnType<typeof decide>) {
  return {
    mspName: plan.msp.name,
    customerName: plan.customerName,
    planId: plan.planId,
    currentPhase: plan.currentStage,
    currentTask: evaluated.currentTask?.title ?? null,
    taskKey: evaluated.currentTask?.templateKey ?? null,
    taskOwner: evaluated.currentTask?.owner ?? null,
    taskStatus: evaluated.currentTask?.status ?? null,
    recipient: evaluated.owner?.normalizedEmail ?? null,
    nextTaskSince: plan.nextTaskSince,
    elapsedBusinessDays: "elapsedBusinessDays" in evaluated.decision ? evaluated.decision.elapsedBusinessDays ?? null : null,
    thresholdBusinessDays: "thresholdBusinessDays" in evaluated.decision ? evaluated.decision.thresholdBusinessDays ?? null : null,
    nextEligibleAt: "nextEligibleAt" in evaluated.decision ? evaluated.decision.nextEligibleAt ?? null : null,
    decisionStatus: evaluated.decision.status,
    eligibility: evaluated.decision.status === "ELIGIBLE"
      ? "Eligible"
      : evaluated.decision.status === "BLOCKED"
        ? "Blocked"
        : "Not Eligible",
    reason: evaluated.decision.reason,
    existingNudgeStatus: plan.nudgeStatus,
    lastJourneyOutcome: evaluated.prior?.attemptedAt ? evaluated.prior.providerResult : null
  };
}

export async function previewZohoNudges(input: { cursor?: string; evaluationAt?: Date; take?: number } = {}) {
  const take = Math.max(1, Math.min(input.take ?? 50, 100));
  const plans = await prisma.onboardingPlan.findMany({
    ...(input.cursor ? { where: { planId: { gt: input.cursor } } } : {}),
    orderBy: { planId: "asc" },
    select: planSelect,
    take: take + 1
  });
  const page = plans.slice(0, take);
  const facts = await loadContextFacts(prisma, page);
  const evaluationAt = input.evaluationAt ?? new Date();
  return {
    evaluationAt,
    timezone: ZOHO_NUDGE_TIMEZONE,
    nextCursor: plans.length > take ? page.at(-1)?.planId ?? null : null,
    decisions: page.map((plan) => previewRow(plan, decide(plan, facts, evaluationAt)))
  };
}

function decisionData(decision: Decision) {
  return {
    elapsedBusinessDays: "elapsedBusinessDays" in decision ? decision.elapsedBusinessDays as number : null,
    nextEligibleAt: "nextEligibleAt" in decision ? decision.nextEligibleAt as Date : null,
    reasonCode: decision.reason,
    status: decision.status,
    thresholdBusinessDays: "thresholdBusinessDays" in decision ? decision.thresholdBusinessDays as number : null
  };
}

async function saveDecision(
  transaction: ZohoTransaction,
  input: { businessDate: string; decision: Decision; plan: NudgePlan; runId: string; statusOverride?: "PREPARED" }
) {
  const owner = input.plan.planContacts[0];
  const currentTask = input.plan.onboardingTasks.find((task) => task.status !== "complete") ?? null;
  return transaction.zohoNudgeEvaluationDecision.upsert({
    where: { runId_onboardingPlanId: { runId: input.runId, onboardingPlanId: input.plan.id } },
    create: {
      ...decisionData(input.decision),
      businessDate: input.businessDate,
      onboardingPlanId: input.plan.id,
      planId: input.plan.planId,
      recipientEmailNormalized: owner?.normalizedEmail,
      runId: input.runId,
      status: input.statusOverride ?? input.decision.status,
      taskKey: currentTask?.templateKey
    },
    update: {
      ...decisionData(input.decision),
      evaluatedAt: new Date(),
      recipientEmailNormalized: owner?.normalizedEmail,
      status: input.statusOverride ?? input.decision.status,
      taskKey: currentTask?.templateKey
    }
  });
}

async function prepareEligibleNudge(input: {
  businessDate: string;
  evaluationAt: Date;
  planId: string;
  runId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-j3-evaluation:${input.planId}`}, 0))
    `);
    const plan = await transaction.onboardingPlan.findUnique({ where: { id: input.planId }, select: planSelect });
    if (!plan) throw new Error("The nudge plan no longer exists.");
    const facts = await loadContextFacts(transaction, [plan]);
    const evaluated = decide(plan, facts, input.evaluationAt);
    if (evaluated.decision.status !== "ELIGIBLE" || !evaluated.currentTask?.templateKey || !evaluated.owner) {
      await saveDecision(transaction, { businessDate: input.businessDate, decision: evaluated.decision, plan, runId: input.runId });
      return { prepared: false, reason: evaluated.decision.reason, status: evaluated.decision.status };
    }

    const occurrenceKey = createStableZohoKey("j3-eligible", plan.planId, evaluated.currentTask.templateKey, evaluated.owner.normalizedEmail);
    await transaction.onboardingPlan.update({
      where: { id: plan.id },
      data: {
        nudgeStartedAt: input.evaluationAt,
        nudgeStatus: "WAITING",
        nudgeTaskKey: evaluated.currentTask.templateKey
      }
    });
    const syncEvents = await recordZohoContactSyncEventsInTransaction(transaction, {
      occurrenceKey: `${occurrenceKey}:contact`,
      onboardingPlanId: plan.id,
      reason: "j3.stalled_task_eligible",
      taskKey: evaluated.currentTask.templateKey
    });
    const journeyEvents = await recordZohoJourneyEventsInTransaction(transaction, {
      journey: "J3_R1",
      occurrenceKey: `${occurrenceKey}:journey`,
      onboardingPlanId: plan.id,
      reason: "j3.stalled_task_eligible",
      taskKey: evaluated.currentTask.templateKey
    });
    if (syncEvents.length !== 1 || journeyEvents.length !== 1) {
      throw new Error("Nudge event emission was disabled or did not produce exactly one owner event.");
    }
    await createZohoAutomationAuditInTransaction(transaction, {
      action: "j3.nudge_prepared",
      actor: "system:zoho-nudge-evaluator",
      evidenceReference: `nudge-run:${input.runId}`,
      onboardingPlanId: plan.id,
      reason: `ELIGIBLE:${evaluated.currentTask.templateKey}`,
      recipientEmail: evaluated.owner.email
    });
    await saveDecision(transaction, {
      businessDate: input.businessDate,
      decision: evaluated.decision,
      plan,
      runId: input.runId,
      statusOverride: "PREPARED"
    });
    return { prepared: true, reason: "ELIGIBLE", status: "PREPARED" as const };
  });
}

async function claimDailyRun(businessDate: string, evaluationAt: Date) {
  const claimId = randomUUID();
  const leaseExpiresAt = new Date(evaluationAt.getTime() + 10 * 60_000);
  try {
    const run = await prisma.zohoNudgeEvaluationRun.create({
      data: {
        businessDate,
        processingClaimId: claimId,
        processingLeaseExpiresAt: leaseExpiresAt,
        startedAt: evaluationAt,
        timezone: ZOHO_NUDGE_TIMEZONE
      }
    });
    return { claimId, run, version: run.version };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const existing = await prisma.zohoNudgeEvaluationRun.findUnique({ where: { businessDate } });
  if (!existing || existing.status === "SUCCEEDED") return null;
  if (existing.status === "RUNNING" && existing.processingLeaseExpiresAt > evaluationAt) return null;
  const claimed = await prisma.zohoNudgeEvaluationRun.updateMany({
    where: {
      id: existing.id,
      version: existing.version,
      OR: [{ status: "FAILED" }, { status: "RUNNING", processingLeaseExpiresAt: { lte: evaluationAt } }]
    },
    data: {
      completedAt: null,
      lastSanitizedError: null,
      processingClaimId: claimId,
      processingLeaseExpiresAt: leaseExpiresAt,
      startedAt: evaluationAt,
      status: "RUNNING",
      version: { increment: 1 }
    }
  });
  if (!claimed.count) return null;
  return { claimId, run: { ...existing, id: existing.id }, version: existing.version + 1 };
}

export async function runDailyZohoNudgeEvaluation(evaluationAt = new Date()) {
  const config = getZohoNudgeConfiguration();
  if (!config.enabled || !isZohoEventEmissionEnabled()) {
    return { disabled: true, reason: !config.enabled ? "NUDGE_EVALUATION_DISABLED" : "EVENT_EMISSION_DISABLED" };
  }
  if (!isBusinessDay(evaluationAt) || !isTorontoDailyNudgeWindow(evaluationAt)) {
    return { disabled: false, skipped: true, reason: "OUTSIDE_TORONTO_DAILY_WINDOW" };
  }
  const businessDate = getZonedBusinessDate(evaluationAt);
  const claim = await claimDailyRun(businessDate, evaluationAt);
  if (!claim) return { businessDate, duplicate: true, disabled: false };
  const byReason: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let cursor: string | undefined;
  try {
    for (;;) {
      const plans = await prisma.onboardingPlan.findMany({
        ...(cursor ? { cursor: { planId: cursor }, skip: 1 } : {}),
        orderBy: { planId: "asc" },
        select: planSelect,
        take: config.batchSize
      });
      if (!plans.length) break;
      const facts = await loadContextFacts(prisma, plans);
      for (const plan of plans) {
        const evaluated = decide(plan, facts, evaluationAt);
        if (evaluated.decision.status === "ELIGIBLE") {
          const prepared = await prepareEligibleNudge({ businessDate, evaluationAt, planId: plan.id, runId: claim.run.id });
          byReason[prepared.reason] = (byReason[prepared.reason] ?? 0) + 1;
          byStatus[prepared.status] = (byStatus[prepared.status] ?? 0) + 1;
        } else {
          await prisma.$transaction((transaction) => saveDecision(transaction, {
            businessDate, decision: evaluated.decision, plan, runId: claim.run.id
          }));
          byReason[evaluated.decision.reason] = (byReason[evaluated.decision.reason] ?? 0) + 1;
          byStatus[evaluated.decision.status] = (byStatus[evaluated.decision.status] ?? 0) + 1;
        }
      }
      cursor = plans.at(-1)?.planId;
      const renewed = await prisma.zohoNudgeEvaluationRun.updateMany({
        where: { id: claim.run.id, processingClaimId: claim.claimId, status: "RUNNING", version: claim.version },
        data: { processingLeaseExpiresAt: new Date(Date.now() + 10 * 60_000) }
      });
      if (!renewed.count) throw new Error("The nudge evaluation lease was lost.");
      if (plans.length < config.batchSize) break;
    }
    const completed = await prisma.zohoNudgeEvaluationRun.updateMany({
      where: { id: claim.run.id, processingClaimId: claim.claimId, status: "RUNNING", version: claim.version },
      data: { completedAt: new Date(), status: "SUCCEEDED", summary: { byReason, byStatus } }
    });
    if (!completed.count) throw new Error("The nudge evaluation completion fence was rejected.");
    return { businessDate, counts: { byReason, byStatus }, disabled: false, duplicate: false };
  } catch (error) {
    await prisma.zohoNudgeEvaluationRun.updateMany({
      where: { id: claim.run.id, processingClaimId: claim.claimId, status: "RUNNING", version: claim.version },
      data: {
        completedAt: new Date(),
        lastSanitizedError: error instanceof Error ? error.message.slice(0, 300) : "Nudge evaluation failed.",
        status: "FAILED"
      }
    });
    throw error;
  }
}

export async function getZohoNudgeSummary() {
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
  const [active, preparedWaiting, uncertain, urgentStopFailures, lastRun] = await Promise.all([
    prisma.onboardingPlan.count({
      where: {
        nudgeStatus: "WAITING",
        zohoJourneySends: { some: { journey: "J3_R1", providerResult: { in: ["TRIGGERED", "ALREADY_TRIGGERED"] } } }
      }
    }),
    prisma.onboardingPlan.count({ where: { nudgeStatus: "WAITING" } }),
    prisma.onboardingPlan.count({
      where: {
        OR: [
          { nudgeStatus: "WAITING", nudgeStartedAt: { lt: tenDaysAgo } },
          { zohoJourneySends: { some: { journey: "J3_R1", attemptedAt: { not: null }, providerResult: "UNKNOWN" } } }
        ]
      }
    }),
    prisma.zohoOutboxEvent.count({ where: { isStopState: true, status: { in: ["HELD", "DEAD"] }, holdReason: { startsWith: "CRITICAL_" } } }),
    prisma.zohoNudgeEvaluationRun.findFirst({ orderBy: { startedAt: "desc" }, select: { completedAt: true, startedAt: true, status: true, summary: true } })
  ]);
  const summary = lastRun?.summary && typeof lastRun.summary === "object" && !Array.isArray(lastRun.summary)
    ? lastRun.summary as { byReason?: Record<string, number>; byStatus?: Record<string, number> }
    : {};
  return {
    activeNudgeCount: active,
    blockedNudgeCount: Number(summary.byStatus?.BLOCKED ?? 0),
    eligibleNudgeCount: Number(summary.byStatus?.PREPARED ?? summary.byStatus?.ELIGIBLE ?? 0),
    lastEvaluationOutcome: lastRun?.status ?? null,
    lastEvaluationTimestamp: lastRun?.completedAt ?? lastRun?.startedAt ?? null,
    preparedWaitingNudgeCount: preparedWaiting,
    uncertainSequenceCount: uncertain,
    urgentStopSyncFailureCount: urgentStopFailures
  };
}
