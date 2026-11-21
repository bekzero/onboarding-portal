import type { ZohoLeadField, ZohoSubscribeResult } from "./zoho-api-core.ts";
import { ZohoApiError } from "./zoho-api-core.ts";
import type { ZohoContactSnapshot } from "./zoho-contact-mapping.ts";
import { buildZohoLeadInfo } from "./zoho-field-mapping.ts";

export type FullContactMembership = {
  complete: boolean;
  listStatuses: Array<"active" | "unsub" | "bounce">;
};

export async function synchronizeFullFieldContact(input: {
  beforeWrite?: () => void;
  fieldMappingVerified: boolean;
  getFields: () => Promise<ZohoLeadField[]>;
  getMembership: () => Promise<FullContactMembership>;
  listKey: string;
  snapshot: ZohoContactSnapshot;
  subscribe: (leadInfo: Record<string, string | number>) => Promise<ZohoSubscribeResult>;
  topicId: string;
  verificationOnly?: boolean;
}) {
  if (!input.listKey.trim()) {
    throw new ZohoApiError("Zoho mailing-list configuration is missing.", "CONFIGURATION");
  }
  if (!/^\d+$/.test(input.topicId.trim())) {
    throw new ZohoApiError("A numeric Partner Onboarding topic ID is required.", "CONFIGURATION");
  }
  if (!input.fieldMappingVerified) {
    throw new ZohoApiError("Zoho field mapping has not been verified.", "CONFIGURATION");
  }

  const membership = await input.getMembership();
  if (!membership.complete) {
    throw new ZohoApiError("Zoho list membership could not be completely verified.", "PROVIDER");
  }
  if (membership.listStatuses.includes("unsub") || membership.listStatuses.includes("bounce")) {
    throw new ZohoApiError(
      "The Zoho recipient is unsubscribed or bounced and will not be resubscribed.",
      "INELIGIBLE_RECIPIENT"
    );
  }
  if (input.verificationOnly) {
    return membership.listStatuses.includes("active")
      ? { classification: "VERIFIED" as const, code: "MEMBERSHIP_VERIFIED" }
      : { classification: "PENDING_VERIFICATION" as const, code: "MEMBERSHIP_NOT_VISIBLE" };
  }

  const fields = await input.getFields();
  let leadInfo: Record<string, string | number>;
  try {
    leadInfo = buildZohoLeadInfo(input.snapshot, fields);
  } catch (error) {
    throw new ZohoApiError(
      error instanceof Error ? error.message : "Zoho field mapping is incomplete.",
      "CONFIGURATION"
    );
  }
  if (Object.keys(leadInfo).length !== 24) {
    throw new ZohoApiError("The Zoho listsubscribe payload must contain exactly 24 supported fields.", "CONFIGURATION");
  }

  input.beforeWrite?.();
  return input.subscribe(leadInfo);
}
