export type EnrollmentSyncDecision =
  | { action: "SKIP"; reason: string }
  | { action: "PREPARE"; holdReason: string | null; status: "HELD" | "PENDING" };

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
    return { action: "PREPARE", holdReason: "INDIVIDUAL_STAFF_IDENTITY_REQUIRED", status: "HELD" };
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
