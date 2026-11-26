export type EmailAutomationBlockerCode =
  | "LEGACY_PLAN_PROTECTED"
  | "ONBOARDING_OWNER_MISSING"
  | "ONBOARDING_OWNER_INVALID"
  | "PERMISSION_EVIDENCE_REQUIRED"
  | "SUBSCRIPTION_EVIDENCE_REQUIRED"
  | "RECIPIENT_SUPPRESSED"
  | "SUPPRESSION_CHECK_INCOMPLETE"
  | "COMMUNICATION_CONTEXT_CONFLICT"
  | "SALES_ENGINEER_DETAILS_REQUIRED"
  | "TASK_MAPPING_REQUIRED"
  | "CONTACT_CONFIGURATION_REQUIRED"
  | "J1_CONFIGURATION_REQUIRED"
  | "LIST_SAFETY_REVIEW_REQUIRED"
  | "PRODUCTION_ROLLOUT_NOT_APPROVED";

export type EmailAutomationBlocker = {
  action: string;
  code: EmailAutomationBlockerCode;
  message: string;
};

export type EmailAutomationEnablementInput = {
  contactConfigurationReady: boolean;
  contextOwnedByAnotherPlan: boolean;
  j1ConfigurationReady: boolean;
  legacyProtected: boolean;
  listSafetyReviewed: boolean;
  membershipComplete: boolean;
  membershipStatuses: Array<"active" | "unsub" | "bounce">;
  ownerExists: boolean;
  ownerValid: boolean;
  permissionEvidencePresent: boolean;
  productionRolloutAllowed: boolean;
  salesEngineerDetailsComplete: boolean;
  subscriptionEvidencePresent: boolean;
  subscriptionStatus: "UNKNOWN" | "PENDING_CONFIRMATION" | "CONFIRMED" | "INELIGIBLE" | "MANUAL_REVIEW" | null;
  taskMappingVerified: boolean;
};

export type EmailAutomationContactConfigurationInput = {
  fieldMappingVerified: boolean;
  listKeyPresent: boolean;
  listPrivacyVerified: boolean;
  oauthConfigured: boolean;
  portalBaseUrlPresent: boolean;
  topicId: string;
};

export function isEmailAutomationContactConfigurationReady(
  input: EmailAutomationContactConfigurationInput
) {
  return Boolean(
    input.oauthConfigured &&
      input.listKeyPresent &&
      input.fieldMappingVerified &&
      input.listPrivacyVerified &&
      input.portalBaseUrlPresent &&
      /^\d+$/.test(input.topicId)
  );
}

export function evaluateEmailAutomationEnablement(
  input: EmailAutomationEnablementInput
): { blockers: EmailAutomationBlocker[]; ready: boolean } {
  const blockers: EmailAutomationBlocker[] = [];
  const add = (code: EmailAutomationBlockerCode, message: string, action: string) => {
    blockers.push({ action, code, message });
  };

  if (input.legacyProtected) {
    add(
      "LEGACY_PLAN_PROTECTED",
      "This historical onboarding case is permanently excluded from automated emails.",
      "No action is available for this protected case."
    );
  }
  if (!input.productionRolloutAllowed) {
    add(
      "PRODUCTION_ROLLOUT_NOT_APPROVED",
      "Automated emails have not been approved for this onboarding case.",
      "Ask KZero support to add this plan to the controlled automation rollout."
    );
  }
  if (!input.ownerExists) {
    add("ONBOARDING_OWNER_MISSING", "An Onboarding Owner is required.", "Add an Onboarding Owner in Edit MSP.");
  } else if (!input.ownerValid) {
    add(
      "ONBOARDING_OWNER_INVALID",
      "The Onboarding Owner name or email is incomplete.",
      "Correct the Onboarding Owner in Edit MSP."
    );
  }
  if (!input.permissionEvidencePresent) {
    add(
      "PERMISSION_EVIDENCE_REQUIRED",
      "Communication permission has not been documented.",
      "Record permission evidence in Edit MSP."
    );
  }
  if (input.subscriptionStatus === "INELIGIBLE" || input.membershipStatuses.some((status) => status !== "active")) {
    add(
      "RECIPIENT_SUPPRESSED",
      "This recipient is unsubscribed, bounced, or otherwise ineligible.",
      "Use a different authorized recipient or resolve the status outside KZero."
    );
  } else if (input.subscriptionStatus !== "CONFIRMED" || !input.subscriptionEvidencePresent) {
    add(
      "SUBSCRIPTION_EVIDENCE_REQUIRED",
      "Subscription eligibility has not been independently confirmed.",
      "Record evidence-backed subscription authorization."
    );
  }
  if (!input.membershipComplete) {
    add(
      "SUPPRESSION_CHECK_INCOMPLETE",
      "Zoho suppression status could not be completely verified.",
      "Try again after Zoho membership checks are available."
    );
  }
  if (input.contextOwnedByAnotherPlan) {
    add(
      "COMMUNICATION_CONTEXT_CONFLICT",
      "This email address is already assigned to another onboarding case.",
      "Have an administrator retire or transfer the existing communication context."
    );
  }
  if (!input.salesEngineerDetailsComplete) {
    add(
      "SALES_ENGINEER_DETAILS_REQUIRED",
      "Assigned Sales Engineer details are incomplete.",
      "Add the Sales Engineer name, email, and booking link in Edit MSP."
    );
  }
  if (!input.taskMappingVerified) {
    add(
      "TASK_MAPPING_REQUIRED",
      "The onboarding task map has not been verified for email automation.",
      "Ask KZero support to review this plan's task mapping."
    );
  }
  if (!input.contactConfigurationReady) {
    add(
      "CONTACT_CONFIGURATION_REQUIRED",
      "Zoho contact synchronization is not fully configured.",
      "Ask KZero support to verify the private list, topic, fields, and credentials."
    );
  }
  if (!input.j1ConfigurationReady) {
    add(
      "J1_CONFIGURATION_REQUIRED",
      "The approved Welcome journey is not ready.",
      "Ask KZero support to verify the active J1 journey configuration."
    );
  }
  if (!input.listSafetyReviewed) {
    add(
      "LIST_SAFETY_REVIEW_REQUIRED",
      "The destination list's downstream email behavior has not been reviewed.",
      "Ask KZero support to complete the Zoho list safety review."
    );
  }

  return { blockers, ready: blockers.length === 0 };
}

export function shouldPrepareInitialJ1(input: {
  automaticJ1Allowed: boolean;
  kickoffBooked: boolean;
  nextTaskKey: string | null;
  nextTaskStatus: string | null;
}) {
  return Boolean(
    input.automaticJ1Allowed &&
      !input.kickoffBooked &&
      input.nextTaskKey === "book-kickoff" &&
      input.nextTaskStatus === "waiting_on_msp"
  );
}

export function selectKZeroEmailSchedule<
  Event extends { eventType: string; status: string }
>(events: Event[]) {
  return {
    held: events.find((event) => event.eventType === "TRIGGER_JOURNEY" && event.status === "HELD") ?? null,
    scheduled: events.find(
      (event) => event.eventType === "TRIGGER_JOURNEY" && ["PENDING", "RETRY"].includes(event.status)
    ) ?? null
  };
}
