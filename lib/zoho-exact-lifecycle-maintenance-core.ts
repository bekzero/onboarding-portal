export type ExactLifecycleEvent = {
  eventType: "UPSERT_CONTACT" | "TRIGGER_JOURNEY";
  id: string;
  journey: "J1" | null;
  planId: string;
  reason: string | null;
  recipientEmailNormalized: string;
  status: string;
};

export function evaluateExactLifecycleMaintenance(input: {
  allowedEmail: string;
  allowedEventIds: Set<string>;
  allowedPlanId: string;
  automaticDispatchEnabled: boolean;
  contactSyncEnabled: boolean;
  contactVerificationRecorded: boolean;
  event: ExactLifecycleEvent;
  eventEmissionEnabled: boolean;
  exactEventDispatchEnabled: boolean;
  fieldMappingVerified: boolean;
  globalKillSwitch: boolean;
  journeyTriggeringEnabled: boolean;
  legacyTestSyncEnabled: boolean;
  listKeyPresent: boolean;
  listPrivacyVerified: boolean;
  mode: string;
  mspEnrollmentContactSyncEnabled: boolean;
  nudgeEvaluationEnabled: boolean;
  oauthConfigured: boolean;
  productionApproved: boolean;
  singleContactPilotEnabled: boolean;
  testContactSyncEnabled: boolean;
  testFixtureEnabled: boolean;
  testJ1EnrollmentEnabled: boolean;
  topicIdValid: boolean;
}) {
  const blockers: string[] = [];
  const contactEvent = input.event.eventType === "UPSERT_CONTACT" && input.event.journey === null;
  const j1Event = input.event.eventType === "TRIGGER_JOURNEY" && input.event.journey === "J1";
  if (!contactEvent && !j1Event) blockers.push("EVENT_TYPE_NOT_APPROVED");
  if (input.event.reason !== "plan.created.test-j1") blockers.push("EVENT_ORIGIN_NOT_APPROVED");
  if (input.event.status !== "PENDING" && input.event.status !== "RETRY") blockers.push("EVENT_NOT_DISPATCHABLE");
  if (
    input.allowedEventIds.size !== 1 ||
    !input.allowedEventIds.has(input.event.id) ||
    input.event.planId !== input.allowedPlanId ||
    input.event.recipientEmailNormalized !== input.allowedEmail
  ) blockers.push("EXACT_TARGET_NOT_ALLOWLISTED");
  if (!input.exactEventDispatchEnabled) blockers.push("EXACT_EVENT_DISPATCH_DISABLED");
  if (input.globalKillSwitch) blockers.push("GLOBAL_KILL_SWITCH_ENABLED");
  if (input.mode !== "test") blockers.push("TEST_MODE_REQUIRED");
  if (!input.contactSyncEnabled) blockers.push("CONTACT_SYNCHRONIZATION_DISABLED");
  if (!input.fieldMappingVerified) blockers.push("FIELD_MAPPING_UNVERIFIED");
  if (!input.oauthConfigured || !input.listKeyPresent || !input.listPrivacyVerified || !input.topicIdValid) blockers.push("PROVIDER_CONFIGURATION_INCOMPLETE");
  if (
    input.automaticDispatchEnabled || input.productionApproved || input.eventEmissionEnabled ||
    input.mspEnrollmentContactSyncEnabled || input.nudgeEvaluationEnabled ||
    input.singleContactPilotEnabled || input.testFixtureEnabled || input.testJ1EnrollmentEnabled
  ) {
    blockers.push("AUTOMATIC_PATH_NOT_ISOLATED");
  }
  if (input.legacyTestSyncEnabled || input.testContactSyncEnabled) blockers.push("LEGACY_WRITE_PATH_ENABLED");
  if (contactEvent && input.journeyTriggeringEnabled) blockers.push("JOURNEY_TRIGGERING_MUST_BE_DISABLED");
  if (j1Event && !input.journeyTriggeringEnabled) blockers.push("JOURNEY_TRIGGERING_DISABLED");
  if (j1Event && !input.contactVerificationRecorded) blockers.push("CONTACT_VALUES_NOT_INDEPENDENTLY_VERIFIED");
  return { allowed: blockers.length === 0, blockers } as const;
}
