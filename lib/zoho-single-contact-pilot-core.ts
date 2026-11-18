export type PilotOutcome =
  | "VERIFIED"
  | "ALREADY_EXISTS"
  | "ACCEPTED_PENDING_VERIFICATION"
  | "BLOCKED"
  | "IGNORED"
  | "UNABLE_TO_VERIFY"
  | "FAILED";

export type PilotMembership = {
  complete: boolean;
  listStatuses: Array<"active" | "unsub" | "bounce">;
};

export type PilotReadiness = {
  blockers: string[];
  canExecute: boolean;
  canPreview: boolean;
  verificationOnly: boolean;
};

export function evaluateSingleContactPilotReadiness(input: {
  automaticDispatchEnabled: boolean;
  communicationContextOwned: boolean;
  contactSyncEnabled: boolean;
  downstreamAutomationVerified: boolean;
  eventEmissionEnabled: boolean;
  globalKillSwitch: boolean;
  journeyTriggeringEnabled: boolean;
  listPrivacyVerified: boolean;
  manualPilotEnabled: boolean;
  nudgeEvaluationEnabled: boolean;
  permissionConfirmed: boolean;
  pilotTargetConfigured: boolean;
  pilotTargetMatches: boolean;
  planAndOwnerApproved: boolean;
  priorReservation: boolean;
  productionApproved: boolean;
  providerConfigured: boolean;
  staffAdminAuthorized: boolean;
  subscriptionStatus: string | null;
  syncOnEnrollmentEnabled: boolean;
  testWritePathsEnabled: boolean;
  dispatchMode: string;
  unresolvedEnrollmentEvent: boolean;
}) : PilotReadiness {
  const blockers: string[] = [];
  if (!input.pilotTargetConfigured) blockers.push("PILOT_TARGET_NOT_CONFIGURED");
  else if (!input.pilotTargetMatches) blockers.push("PILOT_TARGET_NOT_ALLOWLISTED");
  if (!input.staffAdminAuthorized) blockers.push("INDIVIDUAL_ADMIN_IDENTITY_REQUIRED");
  if (!input.permissionConfirmed) blockers.push("CONTACT_PERMISSION_NOT_DOCUMENTED");
  if (!input.planAndOwnerApproved) blockers.push("AUTOMATION_APPROVAL_REQUIRED");
  if (!input.communicationContextOwned) blockers.push("COMMUNICATION_CONTEXT_REQUIRED");
  if (!input.providerConfigured) blockers.push("EMAIL_ONLY_PROVIDER_CONFIGURATION_INCOMPLETE");
  if (!input.listPrivacyVerified) blockers.push("LIST_PRIVACY_UNVERIFIED");
  if (!input.downstreamAutomationVerified) blockers.push("DOWNSTREAM_AUTOMATION_UNVERIFIED");
  if (input.subscriptionStatus !== "CONFIRMED") {
    blockers.push(input.subscriptionStatus === "INELIGIBLE" ? "RECIPIENT_INELIGIBLE" : "SUBSCRIPTION_STATUS_UNVERIFIED");
  }
  if (input.unresolvedEnrollmentEvent) blockers.push("UNRESOLVED_ENROLLMENT_EVENT");
  if (!input.manualPilotEnabled) blockers.push("SINGLE_CONTACT_PILOT_DISABLED");
  if (input.globalKillSwitch) blockers.push("GLOBAL_KILL_SWITCH_ENABLED");

  // The manual pilot is isolated only while every automatic path remains off.
  if (
    input.automaticDispatchEnabled || input.contactSyncEnabled || input.eventEmissionEnabled ||
    input.journeyTriggeringEnabled || input.nudgeEvaluationEnabled || input.productionApproved || input.syncOnEnrollmentEnabled ||
    input.testWritePathsEnabled ||
    input.dispatchMode !== "disabled"
  ) blockers.push("AUTOMATIC_PATH_ISOLATION_REQUIRED");

  if (input.priorReservation) blockers.push("PILOT_EXECUTION_ALREADY_RESERVED");
  const canPreview = input.pilotTargetConfigured && input.pilotTargetMatches && input.staffAdminAuthorized && input.providerConfigured;
  return {
    blockers,
    canExecute: blockers.length === 0,
    canPreview,
    verificationOnly: input.priorReservation
  };
}

export function classifyPilotMembership(membership: PilotMembership) {
  if (!membership.complete) return { outcome: "UNABLE_TO_VERIFY" as const, reason: "INCOMPLETE_MEMBERSHIP_SCAN" };
  if (membership.listStatuses.includes("unsub") || membership.listStatuses.includes("bounce")) {
    return { outcome: "BLOCKED" as const, reason: "SUPPRESSED_CONTACT" };
  }
  if (membership.listStatuses.includes("active")) {
    return { outcome: "ALREADY_EXISTS" as const, reason: "ACTIVE_MEMBERSHIP_FOUND" };
  }
  return { outcome: null, reason: "NOT_PRESENT" };
}

export async function executeSingleContactPilotCore(input: {
  add: () => Promise<{ classification: "ACCEPTED" | "EXISTING" | "IGNORED" | "ERROR"; providerCode: string | null }>;
  check: () => Promise<PilotMembership>;
  record: (stage: string, outcome: PilotOutcome) => Promise<void>;
  reserve: () => Promise<{ acquired: boolean }>;
}): Promise<{ outcome: PilotOutcome; providerWriteAttempted: boolean }> {
  let before: ReturnType<typeof classifyPilotMembership>;
  try {
    before = classifyPilotMembership(await input.check());
  } catch {
    await input.record("membership_precheck", "UNABLE_TO_VERIFY");
    return { outcome: "UNABLE_TO_VERIFY", providerWriteAttempted: false };
  }
  if (before.outcome) {
    await input.record("membership_precheck", before.outcome);
    return { outcome: before.outcome, providerWriteAttempted: false };
  }

  const reservation = await input.reserve();
  if (!reservation.acquired) {
    let verification: ReturnType<typeof classifyPilotMembership>;
    try {
      verification = classifyPilotMembership(await input.check());
    } catch {
      await input.record("verification_only", "UNABLE_TO_VERIFY");
      return { outcome: "UNABLE_TO_VERIFY", providerWriteAttempted: false };
    }
    const outcome = verification.outcome === "ALREADY_EXISTS"
      ? "VERIFIED"
      : verification.outcome === "BLOCKED" || verification.outcome === "UNABLE_TO_VERIFY"
        ? verification.outcome
        : "ACCEPTED_PENDING_VERIFICATION";
    await input.record("verification_only", outcome);
    return { outcome, providerWriteAttempted: false };
  }

  await input.record("provider_write_started", "UNABLE_TO_VERIFY");
  let result: Awaited<ReturnType<typeof input.add>>;
  try {
    result = await input.add();
  } catch {
    await input.record("provider_outcome_uncertain", "UNABLE_TO_VERIFY");
    return { outcome: "UNABLE_TO_VERIFY", providerWriteAttempted: true };
  }

  if (result.classification === "IGNORED") {
    await input.record("provider_result", "IGNORED");
    return { outcome: "IGNORED", providerWriteAttempted: true };
  }
  if (result.classification === "ERROR") {
    await input.record("provider_result", "FAILED");
    return { outcome: "FAILED", providerWriteAttempted: true };
  }
  if (result.classification === "EXISTING") {
    await input.record("provider_result", "ALREADY_EXISTS");
    return { outcome: "ALREADY_EXISTS", providerWriteAttempted: true };
  }

  try {
    const after = classifyPilotMembership(await input.check());
    const outcome = after.outcome === "ALREADY_EXISTS"
      ? "VERIFIED"
      : after.outcome === "BLOCKED"
        ? "BLOCKED"
        : "ACCEPTED_PENDING_VERIFICATION";
    await input.record("membership_verification", outcome);
    return { outcome, providerWriteAttempted: true };
  } catch {
    await input.record("membership_verification", "ACCEPTED_PENDING_VERIFICATION");
    return { outcome: "ACCEPTED_PENDING_VERIFICATION", providerWriteAttempted: true };
  }
}
