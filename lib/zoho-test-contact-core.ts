import type { ZohoBulkAddResult } from "./zoho-api-core.ts";

export type ZohoTestContactCheck = {
  complete: boolean;
  listStatuses: Array<"active" | "unsub" | "bounce">;
};

export type ZohoTestContactCheckResult = {
  classification: "EXISTING" | "NOT_FOUND" | "UNABLE_TO_VERIFY";
  listStatuses: Array<"active" | "unsub" | "bounce">;
  reason: string;
};

export type ZohoTestContactSyncResult = {
  classification: "ACCEPTED" | "VERIFIED" | "EXISTING" | "IGNORED" | "PENDING_VERIFICATION" | "FAILED";
  reason: string;
};

export function classifyZohoTestContactCheck(input: ZohoTestContactCheck): ZohoTestContactCheckResult {
  if (input.listStatuses.length > 0) {
    return {
      classification: "EXISTING",
      listStatuses: input.listStatuses,
      reason: input.listStatuses.includes("active") ? "ACTIVE_LIST_CONTACT" : "SUPPRESSED_LIST_CONTACT"
    };
  }
  return input.complete
    ? { classification: "NOT_FOUND", listStatuses: [], reason: "COMPLETE_SCAN_NO_MATCH" }
    : { classification: "UNABLE_TO_VERIFY", listStatuses: [], reason: "INCOMPLETE_LIST_SCAN" };
}

export async function executeControlledTestContactSync(input: {
  add: () => Promise<ZohoBulkAddResult>;
  check: () => Promise<ZohoTestContactCheck>;
}): Promise<ZohoTestContactSyncResult> {
  let before: ZohoTestContactCheckResult;
  try {
    before = classifyZohoTestContactCheck(await input.check());
  } catch {
    return { classification: "FAILED", reason: "PRE_WRITE_CHECK_FAILED" };
  }
  if (before.classification === "UNABLE_TO_VERIFY") {
    return { classification: "FAILED", reason: "PRE_WRITE_CHECK_INCOMPLETE" };
  }
  if (before.classification === "EXISTING") {
    return before.listStatuses.includes("active")
      ? { classification: "EXISTING", reason: "ALREADY_ACTIVE_IN_LIST" }
      : { classification: "IGNORED", reason: "SUPPRESSED_CONTACT_NOT_RESUBSCRIBED" };
  }

  let added: ZohoBulkAddResult;
  try {
    added = await input.add();
  } catch {
    return { classification: "FAILED", reason: "BULK_ADD_FAILED" };
  }
  const result = added.results[0];
  if (!result || result.classification === "ERROR") {
    return { classification: "FAILED", reason: result?.reason ?? "NO_PROVIDER_RESULT" };
  }
  if (result.classification === "EXISTING") {
    return { classification: "EXISTING", reason: result.reason };
  }
  if (result.classification === "IGNORED") {
    return { classification: "IGNORED", reason: result.reason };
  }

  let after: ZohoTestContactCheckResult;
  try {
    after = classifyZohoTestContactCheck(await input.check());
  } catch {
    return { classification: "PENDING_VERIFICATION", reason: "ACCEPTED_POST_WRITE_CHECK_FAILED" };
  }
  if (after.classification === "EXISTING") {
    return after.listStatuses.includes("active")
      ? { classification: "VERIFIED", reason: "ACTIVE_MEMBERSHIP_VERIFIED" }
      : { classification: "IGNORED", reason: "CONTACT_BECAME_SUPPRESSED" };
  }
  return {
    classification: "PENDING_VERIFICATION",
    reason: after.classification === "UNABLE_TO_VERIFY"
      ? "ACCEPTED_POST_WRITE_CHECK_INCOMPLETE"
      : "ACCEPTED_NOT_YET_VISIBLE"
  };
}
