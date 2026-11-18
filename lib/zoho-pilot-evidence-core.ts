export const PILOT_SUBSCRIPTION_CONFIRMATION = "CONFIRM PRIVATE LIST ADD AUTHORIZATION";

export const REQUIRED_DOWNSTREAM_REVIEW_ITEMS = [
  "listJourneys",
  "campaigns",
  "accountWorkflows",
  "autoresponders",
  "otherListEntryActions"
] as const;

export type DownstreamReviewItem = (typeof REQUIRED_DOWNSTREAM_REVIEW_ITEMS)[number];
export type DownstreamReviewResult = "ACTIVE_AUTOMATION_FOUND" | "NO_UNINTENDED_AUTOMATION";

function clean(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum + 1) : "";
}

export function validatePilotSubscriptionEvidence(input: {
  authorizationBasis: unknown;
  authorizationEvidenceConfirmed: unknown;
  confirmation: unknown;
  evidenceReference: unknown;
}) {
  const authorizationBasis = clean(input.authorizationBasis, 500);
  const evidenceReference = clean(input.evidenceReference, 240);
  if (input.confirmation !== PILOT_SUBSCRIPTION_CONFIRMATION) {
    return { error: "Enter the exact subscription-authorization confirmation phrase." } as const;
  }
  if (input.authorizationEvidenceConfirmed !== true) {
    return { error: "Confirm that the referenced evidence independently supports the intended private-list addition." } as const;
  }
  if (evidenceReference.length < 3 || evidenceReference.length > 240) {
    return { error: "Provide a concise evidence reference between 3 and 240 characters." } as const;
  }
  if (authorizationBasis.length < 10 || authorizationBasis.length > 500) {
    return { error: "Explain the independently supportable authorization basis in 10 to 500 characters." } as const;
  }
  return { authorizationBasis, evidenceReference } as const;
}

export function validateDownstreamAutomationReview(input: {
  evidenceReference: unknown;
  reviewComplete: unknown;
  reviewedItems: unknown;
  reviewResult: unknown;
}) {
  const evidenceReference = clean(input.evidenceReference, 240);
  const reviewedItems = input.reviewedItems && typeof input.reviewedItems === "object"
    ? input.reviewedItems as Record<string, unknown>
    : {};
  if (input.reviewComplete !== true) {
    return { error: "Confirm that the downstream automation review is complete." } as const;
  }
  if (!REQUIRED_DOWNSTREAM_REVIEW_ITEMS.every((item) => reviewedItems[item] === true)) {
    return { error: "Review every required Zoho downstream-automation surface before recording a result." } as const;
  }
  if (input.reviewResult !== "ACTIVE_AUTOMATION_FOUND" && input.reviewResult !== "NO_UNINTENDED_AUTOMATION") {
    return { error: "Select the authoritative downstream automation review result." } as const;
  }
  if (evidenceReference.length < 3 || evidenceReference.length > 240) {
    return { error: "Provide a concise Zoho review evidence reference between 3 and 240 characters." } as const;
  }
  return {
    evidenceReference,
    reviewResult: input.reviewResult as DownstreamReviewResult,
    reviewedItems: [...REQUIRED_DOWNSTREAM_REVIEW_ITEMS]
  } as const;
}
