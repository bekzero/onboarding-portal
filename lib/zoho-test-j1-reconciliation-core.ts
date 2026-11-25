export const TEST_J1_ORIGINAL_EVENT_REASON = "plan.created.test-j1";
export const TEST_J1_RECONCILIATION_EVENT_REASON = "plan.reconciled.test-j1";

export function isApprovedTestJ1EventReason(reason: string | null) {
  return reason === TEST_J1_ORIGINAL_EVENT_REASON || reason === TEST_J1_RECONCILIATION_EVENT_REASON;
}

export function getLinkedTestJ1ContactEventId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const value = (event as Record<string, unknown>).dependsOnContactEventId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isDefinitiveContactProviderOutcome(outcome: string | null) {
  return outcome === "ACCEPTED_UNCONFIRMED" || outcome === "VERIFIED";
}
