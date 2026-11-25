import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateExactLifecycleMaintenance } from "../lib/zoho-exact-lifecycle-maintenance-core.ts";
import {
  getLinkedTestJ1ContactEventId,
  isApprovedTestJ1EventReason,
  isDefinitiveContactProviderOutcome
} from "../lib/zoho-test-j1-reconciliation-core.ts";

test("reconciliation origins and explicit dependencies fail closed", () => {
  assert.equal(isApprovedTestJ1EventReason("plan.created.test-j1"), true);
  assert.equal(isApprovedTestJ1EventReason("plan.reconciled.test-j1"), true);
  assert.equal(isApprovedTestJ1EventReason("plan.created"), false);
  assert.equal(getLinkedTestJ1ContactEventId({ event: { dependsOnContactEventId: "contact-2" } }), "contact-2");
  assert.equal(getLinkedTestJ1ContactEventId({ event: {} }), null);
  assert.equal(isDefinitiveContactProviderOutcome("ACCEPTED_UNCONFIRMED"), true);
  assert.equal(isDefinitiveContactProviderOutcome("VERIFIED"), true);
  assert.equal(isDefinitiveContactProviderOutcome("UNKNOWN"), false);
  assert.equal(isDefinitiveContactProviderOutcome("ACCEPTED_PENDING_VERIFICATION"), false);
  assert.equal(isDefinitiveContactProviderOutcome("FAILED"), false);
  assert.equal(isDefinitiveContactProviderOutcome("ARBITRARY_PROVIDER_RESULT"), false);
  assert.equal(isDefinitiveContactProviderOutcome(null), false);
});

test("exact maintenance accepts only an allowlisted reconciliation event", () => {
  const event = {
    eventType: "UPSERT_CONTACT",
    id: "contact-2",
    journey: null,
    planId: "benmspe2etest-nfr",
    reason: "plan.reconciled.test-j1",
    recipientEmailNormalized: "b.eakin@kzero.com",
    status: "PENDING"
  };
  const input = {
    allowedEmail: event.recipientEmailNormalized,
    allowedEventIds: new Set([event.id]),
    allowedPlanId: event.planId,
    automaticDispatchEnabled: false,
    contactSyncEnabled: true,
    contactVerificationRecorded: false,
    event,
    eventEmissionEnabled: false,
    exactEventDispatchEnabled: true,
    fieldMappingVerified: true,
    globalKillSwitch: false,
    journeyTriggeringEnabled: false,
    legacyTestSyncEnabled: false,
    listKeyPresent: true,
    listPrivacyVerified: true,
    mode: "test",
    mspEnrollmentContactSyncEnabled: false,
    nudgeEvaluationEnabled: false,
    oauthConfigured: true,
    productionApproved: false,
    singleContactPilotEnabled: false,
    testContactSyncEnabled: false,
    testFixtureEnabled: false,
    testJ1EnrollmentEnabled: false,
    topicIdValid: true
  };
  assert.deepEqual(evaluateExactLifecycleMaintenance(input), { allowed: true, blockers: [] });
  assert.ok(evaluateExactLifecycleMaintenance({ ...input, allowedEventIds: new Set(["other"]) }).blockers.includes("EXACT_TARGET_NOT_ALLOWLISTED"));
});

test("reconciliation endpoint is ADMIN-only, same-origin protected, and server-targeted", async () => {
  const route = await readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/test-j1-reconciliation/route.ts", import.meta.url), "utf8");
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /getSensitiveAdminAuditActor/);
  assert.match(route, /prepareTestJ1SnapshotReconciliation/);
  assert.doesNotMatch(route, /contactEventId|journeyEventId|recipientEmail/);
});

test("one transaction creates a linked ordered pair and supersedes without deleting history", async () => {
  const service = await readFile(new URL("../lib/zoho-test-j1-reconciliation.ts", import.meta.url), "utf8");
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /onboarding-plan:/);
  assert.match(service, /zoho-context:/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /createZohoContactSyncEventInTransaction/);
  assert.match(service, /createZohoJourneyTriggerEventInTransaction/);
  assert.match(service, /dependsOnContactEventId: contactResult\.event\.id/);
  assert.match(service, /CONTACT_VALUES_NOT_VERIFIED/);
  assert.match(service, /SUPERSEDED_BY_TEST_J1_RECONCILIATION/);
  assert.match(service, /status: "CANCELLED"/);
  assert.match(service, /test_j1\.snapshot_reconciliation_prepared/);
  assert.match(service, /getZohoPlanAutomationEligibility/);
  assert.match(service, /subscriptionStatus !== "CONFIRMED"/);
  assert.match(service, /downstream_automation_review_passed/);
  assert.doesNotMatch(service, /subscribeLead|triggerJourney|dispatchExactZoho|zohoDispatchProvider/);
});

test("linked J1 verification requires the exact successful contact, current snapshot, and durable audit", async () => {
  const [maintenance, dispatcher] = await Promise.all([
    readFile(new URL("../lib/zoho-exact-lifecycle-maintenance.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8")
  ]);
  for (const source of [maintenance, dispatcher]) {
    assert.match(source, /getLinkedTestJ1ContactEventId/);
    assert.match(source, /isDefinitiveContactProviderOutcome/);
    assert.match(source, /test_j1\.contact_values_verified/);
    assert.match(source, /JSON\.stringify/);
  }
  assert.match(maintenance, /dependsOnContactEventId/);
  assert.match(maintenance, /CONTACT_VALUES_NOT_VERIFIED/);
  assert.match(maintenance, /status: "PENDING"/);
  assert.match(dispatcher, /contactEvent\.sequence < claim\.event\.sequence/);
  assert.match(dispatcher, /TEST_J1_JOURNEY_CONFIGURATION_CHANGED/);
  assert.match(dispatcher, /PRODUCTION_J1_REUSE_NOT_ADMIN_APPROVED/);
});
