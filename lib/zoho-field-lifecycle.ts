import type { ZohoContactSnapshot } from "./zoho-contact-mapping.ts";
import type { ZohoContactDisplayField } from "./zoho-field-mapping.ts";

export type ZohoFieldLifecycleState =
  | "KNOWN_VALUE"
  | "KNOWN_ZERO"
  | "UNKNOWN_OR_NOT_APPLICABLE"
  | "INTENTIONAL_CLEAR_UNVERIFIED"
  | "MISSING"
  | "PROVIDER_UNSUPPORTED";

export const ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS = [
  "Next Task Tip",
  "Next Task Guide URL"
] as const satisfies readonly ZohoContactDisplayField[];

export const ZOHO_PROVIDER_UNSUPPORTED_FIELDS = [
  "Next Task Since",
  "Last MSP Activity",
  "Last SE Touch"
] as const satisfies readonly ZohoContactDisplayField[];

export const ZOHO_JOURNEY_FRESHNESS_FIELDS = {
  // The source documents do not include the deployed Zoho template bodies. Until
  // each template is audited, these journeys must not consume a retained value.
  J1: ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS,
  J3_R1: ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS,
  J5: ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS,
  // J8 is a completion message and does not use next-task guidance.
  J8: []
} as const satisfies Record<"J1" | "J3_R1" | "J5" | "J8", readonly ZohoContactDisplayField[]>;

function hasValue(value: unknown) {
  return typeof value === "number" || (typeof value === "string" && value.trim().length > 0);
}

export function classifyZohoFieldLifecycle(input: {
  current: string | number | null | undefined;
  outboundSupported?: boolean;
  previous?: string | number | null;
}): ZohoFieldLifecycleState {
  if (input.outboundSupported === false) return "PROVIDER_UNSUPPORTED";
  if (input.current === undefined) return "MISSING";
  if (input.current === 0) return "KNOWN_ZERO";
  if (hasValue(input.current)) return "KNOWN_VALUE";
  if (hasValue(input.previous)) return "INTENTIONAL_CLEAR_UNVERIFIED";
  return "UNKNOWN_OR_NOT_APPLICABLE";
}

export function getZohoJourneyFreshnessBlockers(
  journey: "J1" | "J3_R1" | "J5" | "J8",
  snapshot: ZohoContactSnapshot
) {
  return ZOHO_JOURNEY_FRESHNESS_FIELDS[journey].filter((field) => {
    const value = snapshot[field];
    return value === null || (typeof value === "string" && !value.trim());
  });
}
