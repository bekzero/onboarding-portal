export type ExactEventMaintenancePosture = {
  allowlistMatchesTarget: boolean;
  automaticDispatchEnabled: boolean;
  contactSyncEnabled: boolean;
  eventEmissionEnabled: boolean;
  exactEventDispatchEnabled: boolean;
  fieldMappingVerified: boolean;
  globalKillSwitch: boolean;
  journeyTriggeringEnabled: boolean;
  legacyTestSyncEnabled: boolean;
  listKeyPresent: boolean;
  listPrivacyVerified: boolean;
  mode: "disabled" | "test" | "production";
  mspEnrollmentContactSyncEnabled: boolean;
  nudgeEvaluationEnabled: boolean;
  oauthConfigured: boolean;
  productionApproved: boolean;
  singleContactPilotEnabled: boolean;
  testContactSyncEnabled: boolean;
  topicIdValid: boolean;
};

export function evaluateExactEventMaintenancePosture(input: ExactEventMaintenancePosture) {
  const blockers: string[] = [];
  if (!input.exactEventDispatchEnabled) blockers.push("EXACT_EVENT_DISPATCH_DISABLED");
  if (input.globalKillSwitch) blockers.push("GLOBAL_KILL_SWITCH_ENABLED");
  if (input.mode !== "test") blockers.push("DISPATCH_MODE_NOT_TEST");
  if (!input.contactSyncEnabled) blockers.push("CONTACT_SYNC_DISABLED");
  if (!input.allowlistMatchesTarget) blockers.push("EXACT_TARGET_ALLOWLIST_MISMATCH");
  if (!input.fieldMappingVerified) blockers.push("FIELD_MAPPING_UNVERIFIED");
  if (!input.listKeyPresent) blockers.push("LIST_KEY_MISSING");
  if (!input.listPrivacyVerified) blockers.push("LIST_PRIVACY_UNVERIFIED");
  if (!input.oauthConfigured) blockers.push("OAUTH_NOT_CONFIGURED");
  if (!input.topicIdValid) blockers.push("TOPIC_ID_INVALID");
  if (
    input.automaticDispatchEnabled ||
    input.eventEmissionEnabled ||
    input.journeyTriggeringEnabled ||
    input.legacyTestSyncEnabled ||
    input.mspEnrollmentContactSyncEnabled ||
    input.nudgeEvaluationEnabled ||
    input.productionApproved ||
    input.singleContactPilotEnabled ||
    input.testContactSyncEnabled
  ) blockers.push("UNRELATED_WRITE_PATH_ENABLED");
  return { allowed: blockers.length === 0, blockers } as const;
}
