import "server-only";

import type { ZohoContactSnapshot } from "@/lib/zoho-contact-mapping";
import { getZohoApiClient } from "@/lib/zoho-api";
import { ZohoApiError } from "@/lib/zoho-api-core";

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
    void snapshot;
    throw new ZohoApiError(
      "Full Zoho contact-field synchronization is unavailable; the verified bulk endpoint supports email addresses only.",
      "CONFIGURATION"
    );
  },
  async triggerJourney(input) {
    return getZohoApiClient().triggerJourney(input);
  }
};
