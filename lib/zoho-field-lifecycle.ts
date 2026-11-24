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

type ZohoJourney = "J1" | "J3_R1" | "J5" | "J8";
type StaleSensitiveField = (typeof ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS)[number];
type TemplateDependencyEvidence = "REQUIRED" | "PARTIAL_REVIEW_NO_VISIBLE_REFERENCE" | "VERIFIED_NOT_USED";

export const ZOHO_JOURNEY_GUIDANCE_EVIDENCE = {
  J1: {
    "Next Task Tip": "VERIFIED_NOT_USED",
    "Next Task Guide URL": "VERIFIED_NOT_USED"
  },
  J3_R1: {
    "Next Task Tip": "REQUIRED",
    "Next Task Guide URL": "REQUIRED"
  },
  J5: {
    "Next Task Tip": "REQUIRED",
    "Next Task Guide URL": "PARTIAL_REVIEW_NO_VISIBLE_REFERENCE"
  },
  J8: {
    "Next Task Tip": "VERIFIED_NOT_USED",
    "Next Task Guide URL": "VERIFIED_NOT_USED"
  }
} as const satisfies Record<ZohoJourney, Record<StaleSensitiveField, TemplateDependencyEvidence>>;

function freshnessFieldsFor(journey: ZohoJourney) {
  return ZOHO_STALE_SENSITIVE_OPTIONAL_FIELDS.filter(
    (field) => ZOHO_JOURNEY_GUIDANCE_EVIDENCE[journey][field] !== "VERIFIED_NOT_USED"
  );
}

export const ZOHO_JOURNEY_FRESHNESS_FIELDS = {
  J1: freshnessFieldsFor("J1"),
  J3_R1: freshnessFieldsFor("J3_R1"),
  J5: freshnessFieldsFor("J5"),
  J8: freshnessFieldsFor("J8")
} satisfies Record<ZohoJourney, readonly StaleSensitiveField[]>;

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
  journey: ZohoJourney,
  snapshot: ZohoContactSnapshot
) {
  return ZOHO_JOURNEY_FRESHNESS_FIELDS[journey].filter((field) => {
    const value = snapshot[field];
    return value === null || (typeof value === "string" && !value.trim());
  });
}
