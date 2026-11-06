import "server-only";

import type { ZohoContactSnapshot } from "@/lib/zoho-contact-mapping";
import { getZohoApiClient } from "@/lib/zoho-api";
import type { ZohoLeadField } from "@/lib/zoho-api-core";
import { getZohoListKey, getZohoTopicId } from "@/lib/zoho-config";
import { buildZohoLeadInfo } from "@/lib/zoho-field-mapping";

let fieldCache: { expiresAt: number; fields: ZohoLeadField[] } | null = null;

async function getCachedLeadFields() {
  if (fieldCache && fieldCache.expiresAt > Date.now()) return fieldCache.fields;
  const fields = await getZohoApiClient().getAllLeadFields();
  fieldCache = { expiresAt: Date.now() + 10 * 60_000, fields };
  return fields;
}

export type ZohoDispatchProvider = {
  synchronizeContact(snapshot: ZohoContactSnapshot): Promise<{ classification: string; code: string }>;
  triggerJourney(input: {
    journeyKey: string;
    leadEmail: string;
    listKey: string;
    triggerKey: string;
  }): Promise<{ classification: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED"; code: string }>;
};

export const zohoDispatchProvider: ZohoDispatchProvider = {
  async synchronizeContact(snapshot) {
    const listKey = getZohoListKey();
    const topicId = getZohoTopicId();
    if (!listKey || !topicId) throw new Error("Zoho list and topic configuration are incomplete.");
    const fields = await getCachedLeadFields();
    const leadInfo = buildZohoLeadInfo(snapshot, fields);
    return getZohoApiClient().subscribeLead({ leadInfo, listKey, topicId });
  },
  async triggerJourney(input) {
    return getZohoApiClient().triggerJourney(input);
  }
};
