import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateEmailAutomationEnablement,
  isEmailAutomationContactConfigurationReady,
  selectKZeroEmailSchedule,
  shouldPrepareInitialJ1
} from "../lib/zoho-email-automation-core.ts";

function eligible(overrides = {}) {
  return {
    contactConfigurationReady: true,
    contextOwnedByAnotherPlan: false,
    j1ConfigurationReady: true,
    legacyProtected: false,
    listSafetyReviewed: true,
    membershipComplete: true,
    membershipStatuses: [],
    ownerExists: true,
    ownerValid: true,
    permissionEvidencePresent: true,
    salesEngineerDetailsComplete: true,
    subscriptionEvidencePresent: true,
    subscriptionStatus: "CONFIRMED",
    taskMappingVerified: true,
    ...overrides
  };
}

test("eligible current plan passes without weakening consent or provider checks", () => {
  assert.deepEqual(evaluateEmailAutomationEnablement(eligible()), { blockers: [], ready: true });
});

test("tenant-wide field and private-list verification markers fail closed independently", () => {
  const configured = {
    fieldMappingVerified: true,
    listKeyPresent: true,
    listPrivacyVerified: true,
    oauthConfigured: true,
    portalBaseUrlPresent: true,
    topicId: "1329658000000062845"
  };
  assert.equal(isEmailAutomationContactConfigurationReady(configured), true);
  assert.equal(isEmailAutomationContactConfigurationReady({ ...configured, fieldMappingVerified: false }), false);
  assert.equal(isEmailAutomationContactConfigurationReady({ ...configured, listPrivacyVerified: false }), false);
  assert.equal(isEmailAutomationContactConfigurationReady({ ...configured, topicId: "not-numeric" }), false);
});

test("HELD journey work is not presented as a scheduled KZero email", () => {
  const held = { eventType: "TRIGGER_JOURNEY", journey: "J1", status: "HELD" };
  assert.deepEqual(selectKZeroEmailSchedule([held]), { held, scheduled: null });
  const pending = { eventType: "TRIGGER_JOURNEY", journey: "J5", status: "PENDING" };
  assert.deepEqual(selectKZeroEmailSchedule([held, pending]), { held, scheduled: pending });
});

test("immutable legacy cohort always fails closed", () => {
  const result = evaluateEmailAutomationEnablement(eligible({ legacyProtected: true }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "LEGACY_PLAN_PROTECTED"));
});

test("unsubscribed and bounced recipients cannot be enabled", () => {
  for (const status of ["unsub", "bounce"]) {
    const result = evaluateEmailAutomationEnablement(eligible({ membershipStatuses: [status] }));
    assert.equal(result.ready, false);
    assert.ok(result.blockers.some((item) => item.code === "RECIPIENT_SUPPRESSED"));
  }
});

test("unknown consent, incomplete scans, and conflicting ownership fail closed", () => {
  const result = evaluateEmailAutomationEnablement(eligible({
    contextOwnedByAnotherPlan: true,
    membershipComplete: false,
    permissionEvidencePresent: false,
    subscriptionEvidencePresent: false,
    subscriptionStatus: "UNKNOWN"
  }));
  for (const code of [
    "PERMISSION_EVIDENCE_REQUIRED",
    "SUBSCRIPTION_EVIDENCE_REQUIRED",
    "SUPPRESSION_CHECK_INCOMPLETE",
    "COMMUNICATION_CONTEXT_CONFLICT"
  ]) assert.ok(result.blockers.some((item) => item.code === code), `Missing ${code}`);
});

test("J1 is prepared only for the untouched kickoff-booking state", () => {
  assert.equal(shouldPrepareInitialJ1({ automaticJ1Allowed: true, kickoffBooked: false, nextTaskKey: "book-kickoff", nextTaskStatus: "waiting_on_msp" }), true);
  assert.equal(shouldPrepareInitialJ1({ automaticJ1Allowed: true, kickoffBooked: true, nextTaskKey: "book-kickoff", nextTaskStatus: "waiting_on_msp" }), false);
  assert.equal(shouldPrepareInitialJ1({ automaticJ1Allowed: true, kickoffBooked: false, nextTaskKey: "invite-employees", nextTaskStatus: "waiting_on_msp" }), false);
});

test("server workflow is ADMIN-only, locked, audited, contact-first, and provider-write free", async () => {
  const route = await readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/email-automation/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/zoho-email-automation.ts", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8");
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /getSensitiveAdminAuditActor/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /client\.\$transaction/);
  assert.match(service, /email_automation\.enabled/);
  assert.match(service, /email_automation\.disabled/);
  assert.match(service, /status: \{ in: \["PENDING", "HELD", "RETRY"\] \}/);
  assert.match(lifecycle, /dependsOnContactEventId/);
  assert.ok(lifecycle.indexOf("recordZohoContactSyncEvents(transaction") < lifecycle.lastIndexOf("recordZohoJourneyEvents(transaction"));
  assert.doesNotMatch(service, /subscribeLead|triggerJourney|synchronizeContact|dispatchZoho/);
});

test("re-enable creates a fresh contact occurrence while journey dedupe remains in foundation", async () => {
  const service = await readFile(new URL("../lib/zoho-email-automation.ts", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8");
  const foundation = await readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8");
  assert.match(service, /automation-enabled:\$\{audit\.id\}/);
  assert.match(lifecycle, /createStableZohoKey\(\s*"journey"/s);
  assert.match(foundation, /existingSend/);
  assert.match(foundation, /return \{ created: false, event: existingEvent, journeySend: existingSend \}/);
});
