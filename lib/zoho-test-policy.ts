export type ZohoTestPolicyInput = {
  competingActivePlanIds: string[];
  contactAutomationEnabled: boolean;
  contextOwnedByPlan: boolean;
  contextState: "UNASSIGNED" | "ACTIVE" | "RELEASE_PENDING" | "BLOCKED" | null;
  emailAllowlisted: boolean;
  planAllowlisted: boolean;
  planAutomationState: string;
  subscriptionStatus: string;
  testModeEnabled: boolean;
};

export function evaluateZohoTestPolicy(input: ZohoTestPolicyInput) {
  if (!input.testModeEnabled) return { allowed: false, reason: "TEST_MODE_DISABLED" as const };
  if (!input.planAllowlisted) return { allowed: false, reason: "PLAN_NOT_ALLOWLISTED" as const };
  if (!input.emailAllowlisted) return { allowed: false, reason: "EMAIL_NOT_ALLOWLISTED" as const };
  if (!input.contactAutomationEnabled) return { allowed: false, reason: "CONTACT_NOT_ELIGIBLE" as const };
  if (input.planAutomationState !== "ACTIVE") return { allowed: false, reason: "PLAN_NOT_ACTIVE" as const };
  if (["INELIGIBLE", "MANUAL_REVIEW"].includes(input.subscriptionStatus)) {
    return { allowed: false, reason: "SUBSCRIPTION_BLOCKED" as const };
  }
  if (input.contextState !== "ACTIVE" || !input.contextOwnedByPlan) {
    return { allowed: false, reason: "CONTEXT_NOT_ACTIVE" as const };
  }
  if (input.competingActivePlanIds.length > 0) {
    return { allowed: false, reason: "MULTIPLE_ACTIVE_PLANS" as const };
  }
  return { allowed: true, reason: null } as const;
}
