import "server-only";

import { randomUUID } from "node:crypto";
import type { ZohoContactSnapshot } from "@/lib/zoho-contact-mapping";
import { getZohoApiClient } from "@/lib/zoho-api";
import { ZohoApiError } from "@/lib/zoho-api-core";
import { getZohoListKey } from "@/lib/zoho-config";
import {
  EmailOnlyContactSyncError,
  synchronizeEmailOnlyContact
} from "@/lib/zoho-enrollment-sync-core";
import { checkZohoListMembership } from "@/lib/zoho-phase2";

export type ZohoDispatchProvider = {
  synchronizeContact(
    snapshot: ZohoContactSnapshot,
    options?: { verificationOnly?: boolean }
  ): Promise<{ classification: string; code: string }>;
  triggerJourney(input: {
    journeyKey: string;
    leadEmail: string;
    listKey: string;
    triggerKey: string;
  }): Promise<{ classification: "TRIGGERED" | "ALREADY_TRIGGERED" | "IGNORED"; code: string }>;
};

export const zohoDispatchProvider: ZohoDispatchProvider = {
  async synchronizeContact(snapshot, options) {
    // The verified bulk API synchronizes email addresses only. Names and
    // custom fields in the current snapshot are intentionally not submitted.
    const email = snapshot["Lead Email"];
    const listKey = getZohoListKey();
    if (typeof email !== "string" || !email.trim() || !listKey) {
      throw new ZohoApiError("Email-only Zoho contact synchronization is not configured.", "CONFIGURATION");
    }
    const correlationId = randomUUID();
    const check = async () => {
      const membership = await checkZohoListMembership(email, { correlationId });
      return { complete: !membership.truncated, listStatuses: membership.listStatuses };
    };
    try {
      const result = await synchronizeEmailOnlyContact({
        add: () => getZohoApiClient().addLeadsInBulk({ emails: [email], listKey }),
        check,
        verificationOnly: options?.verificationOnly
      });
      return result;
    } catch (error) {
      if (error instanceof EmailOnlyContactSyncError) {
        if (error.reason === "SUPPRESSED_CONTACT" || error.reason === "PROVIDER_IGNORED") {
          throw new ZohoApiError(
            "The Zoho recipient is suppressed or was ignored and will not be resubscribed.",
            "INELIGIBLE_RECIPIENT",
            { providerCode: error.reason }
          );
        }
        throw new ZohoApiError("Zoho list membership could not be completely verified.", "PROVIDER", {
          providerCode: error.reason
        });
      }
      throw error;
    }
  },
  async triggerJourney(input) {
    return getZohoApiClient().triggerJourney(input);
  }
};
