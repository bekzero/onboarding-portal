export type FullFieldTestIntentReadinessInput = {
  automaticDispatchEnabled: boolean;
  contactAutomationEnabled: boolean;
  contactSyncEnabled: boolean;
  contextOwnedByPlan: boolean;
  downstreamAutomationVerified: boolean;
  eventEmissionEnabled: boolean;
  globalKillSwitch: boolean;
  journeyTriggeringEnabled: boolean;
  listPrivacyVerified: boolean;
  membershipComplete: boolean;
  membershipStatuses: Array<"active" | "unsub" | "bounce">;
  nudgeEvaluationEnabled: boolean;
  permissionEvidenceRecorded: boolean;
  pilotTargetMatches: boolean;
  planAutomationActive: boolean;
  productionDispatchApproved: boolean;
  singleContactPilotEnabled: boolean;
  subscriptionEvidenceRecorded: boolean;
  subscriptionStatus: string;
  syncOnEnrollmentEnabled: boolean;
  testContactSyncEnabled: boolean;
  testModeEnabled: boolean;
  dispatchMode: "disabled" | "test" | "production";
};

export function evaluateFullFieldTestIntentReadiness(input: FullFieldTestIntentReadinessInput) {
  const blockers: string[] = [];
  if (!input.pilotTargetMatches) blockers.push("PILOT_TARGET_MISMATCH");
  if (!input.planAutomationActive || !input.contactAutomationEnabled) blockers.push("PLAN_OR_CONTACT_NOT_APPROVED");
  if (!input.contextOwnedByPlan) blockers.push("COMMUNICATION_CONTEXT_NOT_OWNED");
  if (!input.permissionEvidenceRecorded) blockers.push("PERMISSION_EVIDENCE_MISSING");
  if (!input.subscriptionEvidenceRecorded || input.subscriptionStatus === "INELIGIBLE") blockers.push("SUBSCRIPTION_NOT_ELIGIBLE");
  if (!input.downstreamAutomationVerified) blockers.push("DOWNSTREAM_AUTOMATION_UNVERIFIED");
  if (!input.listPrivacyVerified) blockers.push("LIST_PRIVACY_UNVERIFIED");
  if (!input.membershipComplete) blockers.push("MEMBERSHIP_SCAN_INCOMPLETE");
  if (input.membershipStatuses.includes("unsub") || input.membershipStatuses.includes("bounce")) {
    blockers.push("RECIPIENT_SUPPRESSED");
  }
  if (!input.globalKillSwitch) blockers.push("GLOBAL_KILL_SWITCH_REQUIRED");
  if (
    input.automaticDispatchEnabled ||
    input.contactSyncEnabled ||
    input.eventEmissionEnabled ||
    input.journeyTriggeringEnabled ||
    input.nudgeEvaluationEnabled ||
    input.productionDispatchApproved ||
    input.singleContactPilotEnabled ||
    input.syncOnEnrollmentEnabled ||
    input.testContactSyncEnabled ||
    input.testModeEnabled ||
    input.dispatchMode !== "disabled"
  ) blockers.push("AUTOMATION_PATH_ENABLED");

  return { allowed: blockers.length === 0, blockers } as const;
}
