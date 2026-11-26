export type EnrollmentSubscriptionAuthorization = {
  authorizationBasis?: string;
  confirmed: boolean;
  evidenceReference?: string;
};

function clean(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum + 1)
    : "";
}

export function validateEnrollmentSubscriptionAuthorization(input?: {
  authorizationBasis?: unknown;
  confirmed?: unknown;
  evidenceReference?: unknown;
}) {
  const confirmed = input?.confirmed === true;
  const authorizationBasis = clean(input?.authorizationBasis, 500);
  const evidenceReference = clean(input?.evidenceReference, 240);
  if (!confirmed) {
    return { authorizationBasis: "", confirmed: false, evidenceReference: "", valid: true } as const;
  }
  if (evidenceReference.length < 3 || evidenceReference.length > 240) {
    return {
      authorizationBasis,
      confirmed,
      error: "Provide a subscription evidence reference between 3 and 240 characters.",
      evidenceReference,
      valid: false
    } as const;
  }
  if (authorizationBasis.length < 10 || authorizationBasis.length > 500) {
    return {
      authorizationBasis,
      confirmed,
      error: "Explain the independently supportable subscription authorization in 10 to 500 characters.",
      evidenceReference,
      valid: false
    } as const;
  }
  return { authorizationBasis, confirmed, evidenceReference, valid: true } as const;
}
