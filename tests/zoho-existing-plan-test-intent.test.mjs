import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateFullFieldTestIntentReadiness } from "../lib/zoho-existing-plan-test-intent-core.ts";

function ready(overrides = {}) {
  return {
    automaticDispatchEnabled: false,
    contactAutomationEnabled: true,
    contactSyncEnabled: false,
    contextOwnedByPlan: true,
    dispatchMode: "disabled",
    downstreamAutomationVerified: true,
    eventEmissionEnabled: false,
    globalKillSwitch: true,
    journeyTriggeringEnabled: false,
    listPrivacyVerified: true,
    membershipComplete: true,
    membershipStatuses: [],
    nudgeEvaluationEnabled: false,
    permissionEvidenceRecorded: true,
    pilotTargetMatches: true,
    planAutomationActive: true,
    productionDispatchApproved: false,
    singleContactPilotEnabled: false,
    subscriptionEvidenceRecorded: true,
    subscriptionStatus: "UNKNOWN",
    syncOnEnrollmentEnabled: false,
    testContactSyncEnabled: false,
    testModeEnabled: false,
    ...overrides
  };
}

test("exact eligible pilot state can prepare an intent while every sending path stays disabled", () => {
  assert.deepEqual(evaluateFullFieldTestIntentReadiness(ready()), { allowed: true, blockers: [] });
});

test("wrong targeting, missing evidence, and plan or context failures block preparation", () => {
  for (const [override, blocker] of [
    [{ pilotTargetMatches: false }, "PILOT_TARGET_MISMATCH"],
    [{ planAutomationActive: false }, "PLAN_OR_CONTACT_NOT_APPROVED"],
    [{ contactAutomationEnabled: false }, "PLAN_OR_CONTACT_NOT_APPROVED"],
    [{ contextOwnedByPlan: false }, "COMMUNICATION_CONTEXT_NOT_OWNED"],
    [{ permissionEvidenceRecorded: false }, "PERMISSION_EVIDENCE_MISSING"],
    [{ subscriptionEvidenceRecorded: false }, "SUBSCRIPTION_NOT_ELIGIBLE"],
    [{ downstreamAutomationVerified: false }, "DOWNSTREAM_AUTOMATION_UNVERIFIED"],
    [{ listPrivacyVerified: false }, "LIST_PRIVACY_UNVERIFIED"]
  ]) {
    assert.ok(evaluateFullFieldTestIntentReadiness(ready(override)).blockers.includes(blocker));
  }
});

test("incomplete and suppressed membership scans fail closed", () => {
  assert.ok(evaluateFullFieldTestIntentReadiness(ready({ membershipComplete: false })).blockers.includes("MEMBERSHIP_SCAN_INCOMPLETE"));
  for (const status of ["unsub", "bounce"]) {
    assert.ok(evaluateFullFieldTestIntentReadiness(ready({ membershipStatuses: [status] })).blockers.includes("RECIPIENT_SUPPRESSED"));
  }
  assert.equal(evaluateFullFieldTestIntentReadiness(ready({ membershipStatuses: ["active"] })).allowed, true);
});

test("preparation requires the kill switch and rejects every executable automation path", () => {
  assert.ok(evaluateFullFieldTestIntentReadiness(ready({ globalKillSwitch: false })).blockers.includes("GLOBAL_KILL_SWITCH_REQUIRED"));
  for (const override of [
    { automaticDispatchEnabled: true },
    { contactSyncEnabled: true },
    { dispatchMode: "test" },
    { eventEmissionEnabled: true },
    { journeyTriggeringEnabled: true },
    { nudgeEvaluationEnabled: true },
    { productionDispatchApproved: true },
    { singleContactPilotEnabled: true },
    { syncOnEnrollmentEnabled: true },
    { testContactSyncEnabled: true },
    { testModeEnabled: true }
  ]) assert.ok(evaluateFullFieldTestIntentReadiness(ready(override)).blockers.includes("AUTOMATION_PATH_ENABLED"));
});

test("route and service enforce Staff ADMIN, exact server targeting, durable idempotency, audit, and no dispatch", async () => {
  const [route, service, foundation, dispatchRoute, dispatcher] = await Promise.all([
    readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/full-field-test-intent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-existing-plan-test-intent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/zoho/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /getSensitiveAdminAuditActor/);
  assert.match(service, /loadConfiguredPilotPlan/);
  assert.match(service, /checkZohoListMembership/);
  assert.match(service, /getPersistedZohoContactSnapshotWithClient/);
  assert.match(service, /createZohoContactSyncEventInTransaction/);
  assert.match(service, /createZohoAutomationAuditInTransaction/);
  assert.match(service, /existing-plan-full-field-test/);
  assert.match(foundation, /pg_advisory_xact_lock/);
  assert.match(foundation, /findUnique\([\s\S]*eventKey/);
  assert.doesNotMatch(service, /subscribeLead|addLeadsInBulk|triggerJourney|dispatchZohoOutboxBatch/);
  assert.doesNotMatch(service, /TRIGGER_JOURNEY|ZohoJourneySend/);
  assert.match(dispatchRoute, /DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT/);
  assert.match(dispatchRoute, /approvedEvent\.id !== body\.eventId/);
  assert.match(dispatcher, /event\."id" = \$\{eventId\}/);
  assert.match(dispatcher, /dispatchExactZohoOutboxEvent/);
});

test("the UI exposes preparation separately from the email-only live pilot", async () => {
  const ui = await readFile(new URL("../components/zoho-integration-status.tsx", import.meta.url), "utf8");
  assert.match(ui, /Prepare Full-Field Intent/);
  assert.match(ui, /PREPARE ONE FULL-FIELD ZOHO TEST INTENT/);
  assert.match(ui, /never sends, subscribes, or triggers a journey/i);
});
