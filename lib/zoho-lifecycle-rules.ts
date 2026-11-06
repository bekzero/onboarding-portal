export type ZohoLifecycleTaskState = {
  owner: string | null;
  status: string;
  templateKey: string | null;
};

export type ZohoLifecycleTransition = {
  completedTask: ZohoLifecycleTaskState;
  nextTask: ZohoLifecycleTaskState | null;
  previousNextTask: ZohoLifecycleTaskState | null;
};

export function didActiveTaskChange(
  previousTask: ZohoLifecycleTaskState | null,
  nextTask: ZohoLifecycleTaskState | null
) {
  return previousTask?.templateKey !== nextTask?.templateKey;
}

export function isQualifyingKzeroHandoff(transition: ZohoLifecycleTransition) {
  return (
    transition.completedTask.owner === "kzero_se" &&
    transition.completedTask.status === "complete" &&
    Boolean(transition.nextTask?.templateKey) &&
    (transition.nextTask?.owner === "msp" || transition.nextTask?.owner === "shared") &&
    didActiveTaskChange(transition.previousNextTask, transition.nextTask)
  );
}

export function isApprovedJ8Transition(
  tenantType: string | null,
  transition: ZohoLifecycleTransition
) {
  return (
    tenantType?.toLowerCase() === "nfr" &&
    transition.completedTask.templateKey === "complete-first-customer-rollout" &&
    transition.completedTask.status === "complete"
  );
}

export function shouldFinishNudge(
  nudgeTaskKey: string | null,
  completedTaskKey: string | null | undefined,
  nextTaskOwner?: string | null
) {
  return Boolean(
    nudgeTaskKey &&
      (nudgeTaskKey === completedTaskKey ||
        (completedTaskKey === undefined && nextTaskOwner !== "msp" && nextTaskOwner !== "shared"))
  );
}

export function classifyZohoEventDisposition(input: {
  activePlanId: string | null;
  contextState: "UNASSIGNED" | "ACTIVE" | "RELEASE_PENDING" | "BLOCKED" | null;
  journey: boolean;
  marketingApprovalRequired?: boolean;
  planId: string;
  subscriptionStatus: "UNKNOWN" | "PENDING_CONFIRMATION" | "CONFIRMED" | "INELIGIBLE" | "MANUAL_REVIEW";
}) {
  if (!input.contextState || input.contextState === "UNASSIGNED") {
    return { status: "HELD" as const, holdReason: "COMMUNICATION_CONTEXT_REQUIRED" };
  }
  if (input.contextState !== "ACTIVE" || input.activePlanId !== input.planId) {
    return { status: "HELD" as const, holdReason: "COMMUNICATION_CONTEXT_CONFLICT" };
  }
  if (input.subscriptionStatus === "INELIGIBLE") {
    return { status: "HELD" as const, holdReason: "RECIPIENT_INELIGIBLE" };
  }
  if (input.journey && input.subscriptionStatus !== "CONFIRMED") {
    return { status: "HELD" as const, holdReason: "SUBSCRIPTION_NOT_VERIFIED" };
  }
  if (input.marketingApprovalRequired) {
    return { status: "HELD" as const, holdReason: "MARKETING_APPROVAL_REQUIRED" };
  }
  return { status: "PENDING" as const };
}
