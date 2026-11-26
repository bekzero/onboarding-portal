export type ContactDispatchDecision =
  | { state: "SUCCEEDED"; outcome: "VERIFIED" }
  | { state: "RETRY" | "HELD"; outcome: "ACCEPTED_PENDING_VERIFICATION"; reason: string }
  | { state: "HELD"; outcome: string; reason: string };

export function classifyContactDispatchResult(
  classification: string,
  attemptCount: number,
  maximumAttempts: number
): ContactDispatchDecision {
  if (classification === "VERIFIED") {
    return { outcome: "VERIFIED", state: "SUCCEEDED" };
  }
  if (classification === "ACCEPTED_UNCONFIRMED" || classification === "PENDING_VERIFICATION") {
    return attemptCount >= maximumAttempts
      ? {
          outcome: "ACCEPTED_PENDING_VERIFICATION",
          reason: "CONTACT_MEMBERSHIP_UNVERIFIED_AFTER_ACCEPTANCE",
          state: "HELD"
        }
      : {
          outcome: "ACCEPTED_PENDING_VERIFICATION",
          reason: "CONTACT_MEMBERSHIP_PENDING_VERIFICATION",
          state: "RETRY"
        };
  }
  if (classification === "PENDING_CONFIRMATION") {
    return {
      outcome: classification,
      reason: "SUBSCRIPTION_CONFIRMATION_REQUIRED",
      state: "HELD"
    };
  }
  return {
    outcome: classification,
    reason: "CONTACT_PROVIDER_OUTCOME_UNVERIFIED",
    state: "HELD"
  };
}

export function isVerifiedJourneyContactDependency(input: {
  contactEvent: {
    eventType: string;
    lastProviderOutcome: string | null;
    onboardingPlanId: string;
    recipientEmailNormalized: string;
    sequence: bigint;
    status: string;
  } | null;
  journeyEvent: {
    onboardingPlanId: string;
    recipientEmailNormalized: string;
    sequence: bigint;
  };
  snapshotMatches: boolean;
}) {
  const contact = input.contactEvent;
  return Boolean(
    contact &&
      contact.eventType === "UPSERT_CONTACT" &&
      contact.onboardingPlanId === input.journeyEvent.onboardingPlanId &&
      contact.recipientEmailNormalized === input.journeyEvent.recipientEmailNormalized &&
      contact.sequence < input.journeyEvent.sequence &&
      contact.status === "SUCCEEDED" &&
      contact.lastProviderOutcome === "VERIFIED" &&
      input.snapshotMatches
  );
}
