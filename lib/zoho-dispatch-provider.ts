import "server-only";

import type { ZohoContactSnapshot } from "@/lib/zoho-contact-mapping";
import { getZohoApiClient } from "@/lib/zoho-api";
import { ZohoApiError } from "@/lib/zoho-api-core";
import { getZohoListKey, getZohoTopicId } from "@/lib/zoho-config";
import { synchronizeFullFieldContact } from "@/lib/zoho-full-contact-sync-core";
import { checkZohoListMembership } from "@/lib/zoho-phase2";

export type ZohoDispatchProvider = {
  synchronizeContact(
    snapshot: ZohoContactSnapshot,
    options?: { beforeWrite?: () => void | Promise<void>; verificationOnly?: boolean }
  ): Promise<{ classification: string; code: string }>;
  triggerJourney(input: {
    journeyKey: string;
    leadEmail: string;
    listKey: string;
    triggerKey: string;
  }, beforeWrite?: () => void | Promise<void>): Promise<{ classification: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED"; code: string }>;
};

export const zohoDispatchProvider: ZohoDispatchProvider = {
  async synchronizeContact(snapshot, options) {
    const email = snapshot["Lead Email"];
    const listKey = getZohoListKey();
    const topicId = getZohoTopicId();
    if (typeof email !== "string" || !email.trim()) {
      throw new ZohoApiError("The full Zoho contact snapshot has no lead email.", "CONFIGURATION");
    }
    const client = getZohoApiClient();
    return synchronizeFullFieldContact({
      fieldMappingVerified: process.env.ZMA_FIELD_MAPPING_VERIFIED?.trim().toLowerCase() === "true",
      getFields: () => client.getAllLeadFields(),
      getMembership: async () => {
        const membership = await checkZohoListMembership(email);
        return { complete: !membership.truncated, listStatuses: membership.listStatuses };
      },
      listKey,
      snapshot,
      subscribe: (leadInfo) => client.subscribeLead({ leadInfo, listKey, topicId }, options?.beforeWrite),
      topicId,
      verificationOnly: options?.verificationOnly
    });
  },
  async triggerJourney(input, beforeWrite) {
    return getZohoApiClient().triggerJourney(input, beforeWrite);
  }
};
