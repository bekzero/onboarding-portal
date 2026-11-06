export type DispatchRuleInput = {
  automationState: string;
  currentTask: { owner: string | null; status: string; templateKey: string | null } | null;
  eventTaskKey: string | null;
  journey: "J1" | "J3_R1" | "J5" | "J8";
  kickoffBooked: boolean;
  nudgeStatus: string;
  nudgeTaskKey: string | null;
  tenantType: string | null;
  j8Approved: boolean;
  milestoneCompleted: boolean;
};

export function evaluateJourneyApplicability(input: DispatchRuleInput) {
  if (input.journey === "J8") {
    if (!input.j8Approved) return { applicable: false, reason: "J8_MARKETING_APPROVAL_REQUIRED" };
    if (input.tenantType?.toLowerCase() !== "nfr" || input.eventTaskKey !== "complete-first-customer-rollout") {
      return { applicable: false, reason: "J8_MILESTONE_NOT_APPROVED" };
    }
    return input.milestoneCompleted
      ? { applicable: true as const }
      : { applicable: false as const, reason: "J8_MILESTONE_NOT_COMPLETE" };
  }
  if (input.automationState !== "ACTIVE") {
    return { applicable: false as const, reason: "PLAN_NOT_AUTOMATION_ACTIVE" };
  }
  if (input.journey === "J1") {
    if (input.kickoffBooked) return { applicable: false as const, reason: "J1_KICKOFF_ALREADY_BOOKED" };
    return input.currentTask?.templateKey === "book-kickoff" && input.currentTask.status !== "complete"
      ? { applicable: true as const }
      : { applicable: false as const, reason: "J1_KICKOFF_NO_LONGER_CURRENT" };
  }
  if (input.journey === "J3_R1") {
    const validOwner = input.currentTask?.owner === "msp" || input.currentTask?.owner === "shared";
    return input.nudgeStatus === "WAITING" && input.nudgeTaskKey === input.eventTaskKey &&
      input.currentTask?.templateKey === input.eventTaskKey && validOwner && input.currentTask.status !== "complete"
      ? { applicable: true as const }
      : { applicable: false as const, reason: "J3_TASK_NO_LONGER_ACTIONABLE" };
  }
  const validOwner = input.currentTask?.owner === "msp" || input.currentTask?.owner === "shared";
  return input.currentTask?.templateKey === input.eventTaskKey && validOwner && input.currentTask.status !== "complete"
    ? { applicable: true as const }
    : { applicable: false as const, reason: "J5_HANDOFF_NO_LONGER_ACTIONABLE" };
}

export const ZOHO_RETRY_MINUTES = [1, 5, 15, 60] as const;

export function getZohoRetryDelayMs(attemptCount: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  const minutes = ZOHO_RETRY_MINUTES[Math.min(Math.max(attemptCount - 1, 0), ZOHO_RETRY_MINUTES.length - 1)];
  return minutes * 60_000;
}

export function isUncertainJourneyFailure(kind: string) {
  return ["TIMEOUT", "INVALID_RESPONSE", "PROVIDER"].includes(kind);
}
