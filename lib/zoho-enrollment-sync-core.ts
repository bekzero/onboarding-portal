export type EnrollmentSyncDecision =
  | { action: "SKIP"; reason: string }
  | { action: "PREPARE"; holdReason: string | null; status: "HELD" | "PENDING" };

export type EnrollmentSyncReadinessClassification =
  | "READY_FOR_PREPARATION"
  | "MISSING_PERMISSION"
  | "MISSING_EVIDENCE"
  | "STAFF_IDENTITY_REQUIRED"
  | "INVALID_CONTACT"
  | "PLAN_NOT_READY"
  | "AUTOMATION_DISABLED"
  | "ALREADY_SYNCHRONIZED"
  | "BLOCKED"
  | "UNABLE_TO_VERIFY";

export type EnrollmentSyncReadinessInput = Parameters<typeof evaluateEnrollmentContactSync>[0] & {
  alreadySynchronized: boolean;
  contactValid: boolean;
  providerConfigurationReady: boolean;
  subscriptionStatus: "UNKNOWN" | "PENDING_CONFIRMATION" | "CONFIRMED" | "INELIGIBLE" | "MANUAL_REVIEW" | null;
};

export type EnrollmentSyncReadiness = {
  blockers: string[];
  classification: EnrollmentSyncReadinessClassification;
  decision: EnrollmentSyncDecision;
  eligibleIfEnabled: boolean;
  flagBlockers: string[];
  wouldPrepareNow: boolean;
};

export type EnrollmentPilotReadiness = {
  blockers: string[];
  candidateEligible: boolean;
  classification: "ELIGIBLE_FOR_CONTROLLED_PILOT" | "NOT_TARGETED" | "NEEDS_ATTENTION" | "ALREADY_SYNCHRONIZED";
  liveSynchronizationAvailable: false;
};

export function evaluateEnrollmentPilotReadiness(input: {
  alreadySynchronized: boolean;
  automaticDispatchEnabled: boolean;
  communicationContextOwned: boolean;
  contactAutomationEnabled: boolean;
  contactValid: boolean;
  emailOnlyProviderReady: boolean;
  evidenceReference: string;
  globalKillSwitch: boolean;
  hasUnresolvedEnrollmentEvent: boolean;
  listPrivacyVerified: boolean;
  permissionConfirmed: boolean;
  pilotTargetConfigured: boolean;
  pilotTargetMatches: boolean;
  planAutomationActive: boolean;
  staffAdminAuthorized: boolean;
  subscriptionStatus: EnrollmentSyncReadinessInput["subscriptionStatus"];
}): EnrollmentPilotReadiness {
  const blockers: string[] = [];
  if (!input.pilotTargetConfigured) blockers.push("PILOT_TARGET_NOT_CONFIGURED");
  else if (!input.pilotTargetMatches) blockers.push("PILOT_TARGET_NOT_ALLOWLISTED");
  if (!input.staffAdminAuthorized) blockers.push("INDIVIDUAL_ADMIN_IDENTITY_REQUIRED");
  if (!input.permissionConfirmed) blockers.push("CONTACT_PERMISSION_NOT_DOCUMENTED");
  if (input.permissionConfirmed && !input.evidenceReference.trim()) blockers.push("PERMISSION_EVIDENCE_MISSING");
  if (!input.contactValid) blockers.push("INVALID_PRIMARY_CONTACT");
  if (!input.planAutomationActive || !input.contactAutomationEnabled) blockers.push("AUTOMATION_APPROVAL_REQUIRED");
  if (!input.communicationContextOwned) blockers.push("COMMUNICATION_CONTEXT_REQUIRED");
  if (input.subscriptionStatus === "INELIGIBLE") blockers.push("RECIPIENT_INELIGIBLE");
  if (!input.emailOnlyProviderReady) blockers.push("EMAIL_ONLY_PROVIDER_CONFIGURATION_INCOMPLETE");
  if (!input.listPrivacyVerified) blockers.push("LIST_PRIVACY_UNVERIFIED");
  if (input.hasUnresolvedEnrollmentEvent) blockers.push("UNRESOLVED_ENROLLMENT_EVENT");
  if (!input.globalKillSwitch) blockers.push("GLOBAL_KILL_SWITCH_MUST_REMAIN_ENABLED");
  if (input.automaticDispatchEnabled) blockers.push("AUTOMATIC_DISPATCH_MUST_REMAIN_DISABLED");

  const candidateEligible = !input.alreadySynchronized && blockers.length === 0;
  return {
    blockers,
    candidateEligible,
    classification: input.alreadySynchronized
      ? "ALREADY_SYNCHRONIZED"
      : !input.pilotTargetConfigured || !input.pilotTargetMatches
        ? "NOT_TARGETED"
        : candidateEligible
          ? "ELIGIBLE_FOR_CONTROLLED_PILOT"
          : "NEEDS_ATTENTION",
    // Phase 7B.6A intentionally has no execution path.
    liveSynchronizationAvailable: false
  };
}

export function validateEnrollmentContactPermission(input?: {
  confirmed?: boolean;
  evidenceReference?: string;
}) {
  const confirmed = input?.confirmed === true;
  const evidenceReference = input?.evidenceReference?.trim() ?? "";
  return {
    confirmed,
    evidenceReference,
    valid: !confirmed || Boolean(evidenceReference)
  } as const;
}

export function evaluateEnrollmentContactSync(input: {
  automaticDispatchEnabled: boolean;
  communicationContextOwned: boolean;
  contactAutomationEnabled: boolean;
  contactSyncEnabled: boolean;
  eventEmissionEnabled: boolean;
  evidenceReference: string;
  globalKillSwitch: boolean;
  individualStaffIdentity: boolean;
  permissionConfirmed: boolean;
  planAutomationActive: boolean;
  productionApproved: boolean;
  productionMode: boolean;
  syncOnEnrollmentEnabled: boolean;
}): EnrollmentSyncDecision {
  if (!input.permissionConfirmed || !input.evidenceReference.trim()) {
    return { action: "SKIP", reason: "CONTACT_PERMISSION_NOT_DOCUMENTED" };
  }
  if (!input.syncOnEnrollmentEnabled) {
    return { action: "SKIP", reason: "MSP_ENROLLMENT_SYNC_DISABLED" };
  }
  if (!input.eventEmissionEnabled) {
    return { action: "SKIP", reason: "EVENT_EMISSION_DISABLED" };
  }
  if (!input.individualStaffIdentity) {
    return { action: "SKIP", reason: "INDIVIDUAL_STAFF_IDENTITY_REQUIRED" };
  }
  if (input.globalKillSwitch) {
    return { action: "PREPARE", holdReason: "GLOBAL_KILL_SWITCH_ENABLED", status: "HELD" };
  }
  if (!input.contactSyncEnabled) {
    return { action: "PREPARE", holdReason: "CONTACT_SYNCHRONIZATION_DISABLED", status: "HELD" };
  }
  if (!input.productionMode || !input.productionApproved || !input.automaticDispatchEnabled) {
    return { action: "PREPARE", holdReason: "PRODUCTION_DISPATCH_NOT_APPROVED", status: "HELD" };
  }
  if (!input.planAutomationActive || !input.contactAutomationEnabled) {
    return { action: "PREPARE", holdReason: "AUTOMATION_APPROVAL_REQUIRED", status: "HELD" };
  }
  if (!input.communicationContextOwned) {
    return { action: "PREPARE", holdReason: "COMMUNICATION_CONTEXT_REQUIRED", status: "HELD" };
  }
  return { action: "PREPARE", holdReason: null, status: "PENDING" };
}

export function evaluateEnrollmentContactSyncReadiness(
  input: EnrollmentSyncReadinessInput
): EnrollmentSyncReadiness {
  const decision = evaluateEnrollmentContactSync(input);
  const blockers: string[] = [];
  const flagBlockers: string[] = [];

  if (!input.permissionConfirmed) blockers.push("CONTACT_PERMISSION_NOT_DOCUMENTED");
  if (input.permissionConfirmed && !input.evidenceReference.trim()) blockers.push("PERMISSION_EVIDENCE_MISSING");
  if (!input.individualStaffIdentity) blockers.push("INDIVIDUAL_STAFF_IDENTITY_REQUIRED");
  if (!input.contactValid) blockers.push("INVALID_PRIMARY_CONTACT");
  if (input.subscriptionStatus === "INELIGIBLE") blockers.push("RECIPIENT_INELIGIBLE");
  if (!input.planAutomationActive || !input.contactAutomationEnabled) blockers.push("AUTOMATION_APPROVAL_REQUIRED");
  if (!input.communicationContextOwned) blockers.push("COMMUNICATION_CONTEXT_REQUIRED");
  if (!input.providerConfigurationReady) blockers.push("PROVIDER_CONFIGURATION_INCOMPLETE");

  if (!input.syncOnEnrollmentEnabled) flagBlockers.push("MSP_ENROLLMENT_SYNC_DISABLED");
  if (!input.eventEmissionEnabled) flagBlockers.push("EVENT_EMISSION_DISABLED");
  if (input.globalKillSwitch) flagBlockers.push("GLOBAL_KILL_SWITCH_ENABLED");
  if (!input.contactSyncEnabled) flagBlockers.push("CONTACT_SYNCHRONIZATION_DISABLED");
  if (!input.productionMode || !input.productionApproved || !input.automaticDispatchEnabled) {
    flagBlockers.push("PRODUCTION_DISPATCH_NOT_APPROVED");
  }

  const mandatoryBlockers = blockers.filter((reason) => reason !== "PROVIDER_CONFIGURATION_INCOMPLETE");
  const eligibleIfEnabled = mandatoryBlockers.length === 0 && input.providerConfigurationReady && !input.alreadySynchronized;
  let classification: EnrollmentSyncReadinessClassification;
  if (input.alreadySynchronized) classification = "ALREADY_SYNCHRONIZED";
  else if (!input.permissionConfirmed) classification = "MISSING_PERMISSION";
  else if (!input.evidenceReference.trim()) classification = "MISSING_EVIDENCE";
  else if (!input.individualStaffIdentity) classification = "STAFF_IDENTITY_REQUIRED";
  else if (!input.contactValid) classification = "INVALID_CONTACT";
  else if (input.subscriptionStatus === "INELIGIBLE") classification = "BLOCKED";
  else if (!input.planAutomationActive || !input.contactAutomationEnabled || !input.communicationContextOwned) classification = "PLAN_NOT_READY";
  else if (!input.providerConfigurationReady) classification = "BLOCKED";
  else if (flagBlockers.length > 0) classification = "AUTOMATION_DISABLED";
  else if (decision.action === "PREPARE") classification = "READY_FOR_PREPARATION";
  else classification = "UNABLE_TO_VERIFY";

  return {
    blockers: [...blockers, ...flagBlockers],
    classification,
    decision,
    eligibleIfEnabled,
    flagBlockers,
    wouldPrepareNow: !input.alreadySynchronized && decision.action === "PREPARE"
  };
}

export type EmailOnlyMembership = {
  complete: boolean;
  listStatuses: Array<"active" | "unsub" | "bounce">;
};

export type EmailOnlySyncResult = {
  classification: "EXISTING" | "VERIFIED" | "PENDING_VERIFICATION";
  code: string;
};

export class EmailOnlyContactSyncError extends Error {
  constructor(readonly reason: "INCOMPLETE_SCAN" | "PROVIDER_IGNORED" | "SUPPRESSED_CONTACT") {
    super(reason);
    this.name = "EmailOnlyContactSyncError";
  }
}

export async function synchronizeEmailOnlyContact(input: {
  add: () => Promise<{
    results: Array<{ classification: "ACCEPTED" | "EXISTING" | "IGNORED" | "ERROR"; providerCode: string | null }>;
  }>;
  check: () => Promise<EmailOnlyMembership>;
  verificationOnly?: boolean;
}): Promise<EmailOnlySyncResult> {
  const before = await input.check();
  if (!before.complete) throw new EmailOnlyContactSyncError("INCOMPLETE_SCAN");
  if (before.listStatuses.some((status) => status === "unsub" || status === "bounce")) {
    throw new EmailOnlyContactSyncError("SUPPRESSED_CONTACT");
  }
  if (before.listStatuses.includes("active")) return { classification: "EXISTING", code: "0" };
  if (input.verificationOnly) {
    return { classification: "PENDING_VERIFICATION", code: "PENDING_VERIFICATION" };
  }

  const added = (await input.add()).results[0];
  if (!added || added.classification === "ERROR") {
    throw new Error("Zoho did not accept the contact operation.");
  }
  if (added.classification === "IGNORED") {
    throw new EmailOnlyContactSyncError("PROVIDER_IGNORED");
  }
  if (added.classification === "EXISTING") {
    return { classification: "EXISTING", code: added.providerCode ?? "0" };
  }

  const after = await input.check();
  if (after.listStatuses.some((status) => status === "unsub" || status === "bounce")) {
    throw new EmailOnlyContactSyncError("SUPPRESSED_CONTACT");
  }
  if (after.complete && after.listStatuses.includes("active")) {
    return { classification: "VERIFIED", code: added.providerCode ?? "0" };
  }
  return { classification: "PENDING_VERIFICATION", code: added.providerCode ?? "0" };
}
