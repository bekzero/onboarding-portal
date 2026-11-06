import { calculateBusinessDayEligibility, ZOHO_NUDGE_TIMEZONE } from "./zoho-business-days.ts";

export const ZOHO_NUDGE_THRESHOLDS = {
  "Tenant Setup": 4,
  "App Review": 4,
  "SSO Rollout": 4,
  "First Customer Pilot": 7
} as const;

export type ZohoNudgeReason =
  | "ELIGIBLE"
  | "KICKOFF_HANDLED_BY_J1"
  | "WAITING_ON_KZERO"
  | "PLAN_PAUSED"
  | "PLAN_COMPLETE"
  | "AUTOMATION_EXCLUDED"
  | "AUTOMATION_NOT_ACTIVE"
  | "TASK_MAPPING_NEEDS_REVIEW"
  | "MISSING_ACTIVE_TASK"
  | "MISSING_TASK_KEY"
  | "MISSING_TASK_TIMESTAMP"
  | "TASK_STATUS_NOT_ACTIONABLE"
  | "PHASE_NOT_NUDGEABLE"
  | "BELOW_THRESHOLD"
  | "MISSING_ONBOARDING_OWNER"
  | "RECIPIENT_NOT_AUTOMATION_ENABLED"
  | "SUBSCRIPTION_UNVERIFIED"
  | "CONTEXT_CONFLICT"
  | "MULTIPLE_ACTIVE_PLANS"
  | "ACTIVE_SEQUENCE"
  | "UNCERTAIN_SEQUENCE"
  | "FAILED_SEQUENCE_REVIEW_REQUIRED"
  | "STALE_SEQUENCE_REVIEW_REQUIRED"
  | "ALREADY_NUDGED";

export type ZohoNudgeRuleInput = {
  automationEnrollmentState: string;
  automationOrigin: string;
  automationTaskMappingState: string;
  competingActivePlanCount: number;
  contextActivePlanId: string | null;
  contextState: string | null;
  currentStage: string | null;
  currentTask: { owner: string | null; status: string; templateKey: string | null } | null;
  evaluationAt: Date;
  hasPriorJ3: boolean;
  nextTaskSince: Date | null;
  nudgeStartedAt: Date | null;
  nudgeStatus: string;
  onboardingPlanId: string;
  owner: {
    automationEnabled: boolean;
    normalizedEmail: string;
    subscriptionStatus: string;
  } | null;
  planStatus: string;
  priorJ3Attempted: boolean;
  priorJ3Result: string | null;
};

function result(status: "ELIGIBLE" | "NOT_ELIGIBLE" | "BLOCKED", reason: ZohoNudgeReason, extra: Record<string, unknown> = {}) {
  return { status, reason, ...extra };
}

export function evaluateZohoNudgeEligibility(input: ZohoNudgeRuleInput) {
  // Origin describes how the plan entered the portal; enrollment state is the
  // authorization gate. Legacy plans remain excluded by default, but an
  // explicitly reviewed legacy plan may be made ACTIVE without losing its
  // historical origin. A truthful nextTaskSince is still required below.
  if (input.automationEnrollmentState === "EXCLUDED") {
    return result("NOT_ELIGIBLE", "AUTOMATION_EXCLUDED");
  }
  if (input.automationEnrollmentState === "PAUSED" || input.planStatus.toLowerCase() === "paused") {
    return result("NOT_ELIGIBLE", "PLAN_PAUSED");
  }
  if (input.automationEnrollmentState === "COMPLETE" || input.planStatus.toLowerCase() === "complete") {
    return result("NOT_ELIGIBLE", "PLAN_COMPLETE");
  }
  if (input.automationEnrollmentState !== "ACTIVE") {
    return result("NOT_ELIGIBLE", "AUTOMATION_NOT_ACTIVE");
  }
  if (input.nudgeStatus === "WAITING") {
    const olderThanTenDays = Boolean(input.nudgeStartedAt && input.evaluationAt.getTime() - input.nudgeStartedAt.getTime() > 10 * 86_400_000);
    if (olderThanTenDays) {
      if (!input.priorJ3Attempted || input.priorJ3Result === "UNKNOWN") {
        return result("BLOCKED", "UNCERTAIN_SEQUENCE");
      }
      if (input.priorJ3Result === "FAILED" || input.priorJ3Result === "IGNORED") {
        return result("BLOCKED", "FAILED_SEQUENCE_REVIEW_REQUIRED");
      }
      return result("BLOCKED", "STALE_SEQUENCE_REVIEW_REQUIRED");
    }
    return result("NOT_ELIGIBLE", "ACTIVE_SEQUENCE");
  }
  if (input.currentStage?.trim().toLowerCase() === "kickoff") {
    return result("NOT_ELIGIBLE", "KICKOFF_HANDLED_BY_J1");
  }
  if (input.automationTaskMappingState !== "VERIFIED") {
    return result("BLOCKED", "TASK_MAPPING_NEEDS_REVIEW");
  }
  if (!input.currentTask) return result("BLOCKED", "MISSING_ACTIVE_TASK");
  if (!input.currentTask.templateKey) return result("BLOCKED", "MISSING_TASK_KEY");
  if (input.hasPriorJ3) {
    if (input.priorJ3Result === "UNKNOWN" && input.priorJ3Attempted) {
      return result("BLOCKED", "UNCERTAIN_SEQUENCE");
    }
    return result("NOT_ELIGIBLE", "ALREADY_NUDGED");
  }
  if (input.currentTask.owner === "kzero_se") return result("NOT_ELIGIBLE", "WAITING_ON_KZERO");
  if (input.currentTask.owner !== "msp" && input.currentTask.owner !== "shared") {
    return result("NOT_ELIGIBLE", "WAITING_ON_KZERO");
  }
  if (!["waiting_on_msp", "in_progress"].includes(input.currentTask.status)) {
    return result("NOT_ELIGIBLE", "TASK_STATUS_NOT_ACTIONABLE");
  }
  const threshold = ZOHO_NUDGE_THRESHOLDS[input.currentStage as keyof typeof ZOHO_NUDGE_THRESHOLDS];
  if (!threshold) return result("NOT_ELIGIBLE", "PHASE_NOT_NUDGEABLE");
  if (!input.nextTaskSince) {
    return result("BLOCKED", "MISSING_TASK_TIMESTAMP", { thresholdBusinessDays: threshold });
  }
  const timing = calculateBusinessDayEligibility({
    start: input.nextTaskSince,
    thresholdBusinessDays: threshold,
    evaluationAt: input.evaluationAt,
    timezone: ZOHO_NUDGE_TIMEZONE
  });
  const timingFields = {
    elapsedBusinessDays: timing.elapsedBusinessDays,
    nextEligibleAt: timing.nextEligibleAt,
    thresholdBusinessDays: threshold
  };
  if (!timing.eligible) return result("NOT_ELIGIBLE", "BELOW_THRESHOLD", timingFields);
  if (!input.owner) return result("BLOCKED", "MISSING_ONBOARDING_OWNER", timingFields);
  if (!input.owner.automationEnabled) return result("BLOCKED", "RECIPIENT_NOT_AUTOMATION_ENABLED", timingFields);
  if (input.owner.subscriptionStatus !== "CONFIRMED") {
    return result("BLOCKED", "SUBSCRIPTION_UNVERIFIED", timingFields);
  }
  if (input.contextState !== "ACTIVE" || input.contextActivePlanId !== input.onboardingPlanId) {
    return result("BLOCKED", "CONTEXT_CONFLICT", timingFields);
  }
  if (input.competingActivePlanCount > 0) {
    return result("BLOCKED", "MULTIPLE_ACTIVE_PLANS", timingFields);
  }
  return result("ELIGIBLE", "ELIGIBLE", timingFields);
}
