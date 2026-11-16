import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getZohoApiClient } from "@/lib/zoho-api";
import { logZohoDiagnostic } from "@/lib/zoho-api-core";
import {
  getZohoDispatchConfiguration,
  getZohoListKey,
  getZohoTestContactSyncConfiguration
} from "@/lib/zoho-config";
import { normalizeZohoRecipientEmail } from "@/lib/zoho-foundation";
import { checkZohoListMembership } from "@/lib/zoho-phase2";
import {
  classifyZohoTestContactCheck,
  executeControlledTestContactSync,
  type ZohoTestContactCheck
} from "@/lib/zoho-test-contact-core";
import { ZohoAdminValidationError, normalizeRequiredEmail } from "@/lib/zoho-validation";
import { prisma } from "@/lib/prisma";

const CONFIRMATION = "SYNC ALLOWLISTED TEST CONTACT";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readMembership(email: string, correlationId: string): Promise<ZohoTestContactCheck> {
  const membership = await checkZohoListMembership(email, { correlationId });
  return {
    complete: !membership.truncated,
    listStatuses: membership.listStatuses
  };
}

export async function checkZohoTestContact(emailValue: unknown, correlationId = randomUUID()) {
  const { normalizedEmail } = normalizeRequiredEmail(emailValue, "Test contact email");
  try {
    const result = classifyZohoTestContactCheck(await readMembership(normalizedEmail, correlationId));
    return { ...result, correlationId, normalizedEmail };
  } catch {
    logZohoDiagnostic({
      classification: "ZOHO_CHECK_FAILED",
      correlationId,
      stage: "getleads"
    });
    return {
      classification: "UNABLE_TO_VERIFY" as const,
      correlationId,
      listStatuses: [],
      normalizedEmail,
      reason: "ZOHO_CHECK_FAILED"
    };
  }
}

async function claimRequest(input: { actor: string; normalizedEmail: string; requestId: string }) {
  const businessDate = new Date().toISOString().slice(0, 10);
  const id = `zoho_test_${createHash("sha256").update(`${input.normalizedEmail}:${businessDate}`).digest("hex")}`;
  const requestFingerprint = createHash("sha256").update(input.requestId).digest("hex").slice(0, 16);
  try {
    await prisma.zohoAutomationAudit.create({
      data: {
        id,
        action: "zoho.test_contact_sync.requested",
        actor: input.actor,
        evidenceReference: `email-only-bulk-list-add:${requestFingerprint}`,
        reason: `Authorized allowlisted test contact sync requested for ${businessDate}.`,
        recipientEmailNormalized: input.normalizedEmail
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ZohoAdminValidationError("A test sync for this email has already been attempted today.", 409);
    }
    throw error;
  }
}

export async function syncZohoTestContact(input: {
  actor: string;
  confirmation: unknown;
  email: unknown;
  requestId: unknown;
}) {
  if (input.confirmation !== CONFIRMATION) {
    throw new ZohoAdminValidationError("Explicit confirmation is required for this Zoho test write.");
  }
  if (typeof input.requestId !== "string" || !REQUEST_ID_PATTERN.test(input.requestId)) {
    throw new ZohoAdminValidationError("A valid one-time test request identifier is required.");
  }
  const { normalizedEmail } = normalizeRequiredEmail(input.email, "Test contact email");
  const test = getZohoTestContactSyncConfiguration();
  if (!test.enabled) {
    throw new ZohoAdminValidationError("Zoho test contact synchronization is disabled.", 403);
  }
  if (getZohoDispatchConfiguration().globalKillSwitch) {
    throw new ZohoAdminValidationError("The Zoho global kill switch blocks external test writes.", 403);
  }
  if (!test.allowedEmails.has(normalizedEmail)) {
    throw new ZohoAdminValidationError("This email is not on the server-side Zoho test allowlist.", 403);
  }
  const listKey = getZohoListKey();
  if (!listKey) throw new ZohoAdminValidationError("Zoho mailing-list configuration is missing.", 503);

  await claimRequest({ actor: input.actor, normalizedEmail, requestId: input.requestId });
  const result = await executeControlledTestContactSync({
    add: () => getZohoApiClient().addLeadsInBulk({ emails: [normalizedEmail], listKey }),
    check: () => readMembership(normalizedEmail, input.requestId as string)
  });
  await prisma.zohoAutomationAudit.create({
    data: {
      action: `zoho.test_contact_sync.${result.classification.toLowerCase()}`,
      actor: input.actor,
      evidenceReference: "email-only-bulk-list-add",
      reason: `${result.classification}: ${result.reason}. No custom fields, consent, journey, or delivery status inferred.`,
      recipientEmailNormalized: normalizeZohoRecipientEmail(normalizedEmail)
    }
  });
  return { ...result, normalizedEmail };
}

export { CONFIRMATION as ZOHO_TEST_CONTACT_CONFIRMATION };
