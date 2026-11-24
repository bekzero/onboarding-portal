import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateExactLifecycleMaintenance } from "../lib/zoho-exact-lifecycle-maintenance-core.ts";
import { getZohoJourneyFreshnessBlockers, ZOHO_JOURNEY_GUIDANCE_EVIDENCE } from "../lib/zoho-field-lifecycle.ts";

const contactEvent = {
  eventType: "UPSERT_CONTACT",
  id: "contact-event",
  journey: null,
  planId: "benmspe2etest-nfr",
  reason: "plan.created.test-j1",
  recipientEmailNormalized: "b.eakin@kzero.com",
  status: "PENDING"
};

function posture(event = contactEvent, overrides = {}) {
  return {
    allowedEmail: "b.eakin@kzero.com",
    allowedEventIds: new Set([event.id]),
    allowedPlanId: "benmspe2etest-nfr",
    automaticDispatchEnabled: false,
    contactSyncEnabled: true,
    contactVerificationRecorded: true,
    event,
    eventEmissionEnabled: false,
    exactEventDispatchEnabled: true,
    fieldMappingVerified: true,
    globalKillSwitch: false,
    journeyTriggeringEnabled: event.eventType === "TRIGGER_JOURNEY",
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
    topicIdValid: true,
    ...overrides
  };
}

test("exact contact maintenance allows only the sole event, plan, recipient, and approved origin", () => {
  assert.deepEqual(evaluateExactLifecycleMaintenance(posture()), { allowed: true, blockers: [] });
  for (const [override, blocker] of [
    [{ allowedEventIds: new Set(["wrong"]) }, "EXACT_TARGET_NOT_ALLOWLISTED"],
    [{ allowedPlanId: "wrong-plan" }, "EXACT_TARGET_NOT_ALLOWLISTED"],
    [{ allowedEmail: "wrong@example.test" }, "EXACT_TARGET_NOT_ALLOWLISTED"],
    [{ event: { ...contactEvent, reason: "other" } }, "EVENT_ORIGIN_NOT_APPROVED"],
    [{ event: { ...contactEvent, status: "SUCCEEDED" } }, "EVENT_NOT_DISPATCHABLE"]
  ]) assert.ok(evaluateExactLifecycleMaintenance(posture(contactEvent, override)).blockers.includes(blocker));
});

test("contact maintenance rejects every unrelated automation path and keeps journeys off", () => {
  for (const [override, blocker] of [
    [{ globalKillSwitch: true }, "GLOBAL_KILL_SWITCH_ENABLED"],
    [{ journeyTriggeringEnabled: true }, "JOURNEY_TRIGGERING_MUST_BE_DISABLED"],
    [{ automaticDispatchEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ eventEmissionEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ mspEnrollmentContactSyncEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ nudgeEvaluationEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ singleContactPilotEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ testFixtureEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ testJ1EnrollmentEnabled: true }, "AUTOMATIC_PATH_NOT_ISOLATED"],
    [{ legacyTestSyncEnabled: true }, "LEGACY_WRITE_PATH_ENABLED"],
    [{ testContactSyncEnabled: true }, "LEGACY_WRITE_PATH_ENABLED"]
  ]) assert.ok(evaluateExactLifecycleMaintenance(posture(contactEvent, override)).blockers.includes(blocker));
});

test("J1 maintenance requires independent contact verification and enables only journey triggering", () => {
  const journey = { ...contactEvent, eventType: "TRIGGER_JOURNEY", id: "j1-event", journey: "J1" };
  assert.deepEqual(evaluateExactLifecycleMaintenance(posture(journey)), { allowed: true, blockers: [] });
  assert.ok(evaluateExactLifecycleMaintenance(posture(journey, { contactVerificationRecorded: false })).blockers.includes("CONTACT_VALUES_NOT_INDEPENDENTLY_VERIFIED"));
  assert.ok(evaluateExactLifecycleMaintenance(posture(journey, { journeyTriggeringEnabled: false })).blockers.includes("JOURNEY_TRIGGERING_DISABLED"));
  assert.ok(evaluateExactLifecycleMaintenance(posture({ ...journey, journey: null })).blockers.includes("EVENT_TYPE_NOT_APPROVED"));
});

test("J1 remains fail-closed until exact assigned template evidence is complete", () => {
  assert.deepEqual(ZOHO_JOURNEY_GUIDANCE_EVIDENCE.J1, {
    "Next Task Tip": "PARTIAL_REVIEW_NO_VISIBLE_REFERENCE",
    "Next Task Guide URL": "PARTIAL_REVIEW_NO_VISIBLE_REFERENCE"
  });
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J1", {
    "Next Task Tip": null,
    "Next Task Guide URL": null
  }), ["Next Task Tip", "Next Task Guide URL"]);
});

test("context retirement is ADMIN-only, locked, audited, reversible before successor creation, and never dispatches", async () => {
  const [route, context] = await Promise.all([
    readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/readiness-controls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-context-admin.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /RETIRE_CONTEXT_FOR_TEST_SUCCESSOR/);
  assert.match(route, /RESTORE_RETIRED_CONTEXT/);
  assert.match(context, /pg_advisory_xact_lock/);
  assert.match(context, /\$executeRaw/);
  assert.match(context, /status: \{ in: \["PENDING", "HELD", "PROCESSING", "RETRY"\] \}/);
  assert.match(context, /providerResult: "UNKNOWN"/);
  assert.match(context, /automationEnrollmentState: "PAUSED"/);
  assert.match(context, /automationEnabled: false/);
  assert.match(context, /state: "UNASSIGNED"/);
  assert.match(context, /CONTEXT_RETIRED_ACTION/);
  assert.match(context, /CONTEXT_RESTORED_ACTION/);
  assert.doesNotMatch(context, /subscribeLead|addLeadsInBulk|triggerJourney|dispatchZoho/);
});

test("new TEST J1 enrollment uses a separate preparation gate and creates durable ordered intents", async () => {
  const [config, persistence, lifecycle, phase2] = await Promise.all([
    readFile(new URL("../lib/zoho-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-phase2.ts", import.meta.url), "utf8")
  ]);
  assert.match(config, /ZOHO_TEST_J1_ENROLLMENT_ENABLED/);
  assert.match(persistence, /recordAllowlistedZohoTestJ1EnrollmentInTransaction/);
  assert.match(persistence, /zoho-context:/);
  assert.match(lifecycle, /occurrenceKey: `plan-created:\$\{plan\.planId\}`/);
  assert.match(lifecycle, /occurrenceKey: `plan-created-j1:\$\{plan\.planId\}`/);
  assert.match(lifecycle, /reason: "plan\.created\.test-j1"/);
  assert.match(lifecycle, /journeyHeldForSubscription/);
  assert.match(phase2, /getZohoTestJ1EnrollmentConfiguration/);
  assert.match(phase2, /payload: \{ path: \["event", "reason"\], equals: "plan\.created\.test-j1" \}/);
  assert.match(phase2, /dispatchConfiguration\.globalKillSwitch/);
  assert.match(phase2, /status: "PENDING"/);
});

test("exact dispatcher preserves contact-before-J1 sequencing and refuses stale snapshots", async () => {
  const [route, dispatcher, service] = await Promise.all([
    readFile(new URL("../app/api/admin/zoho/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-exact-lifecycle-maintenance.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /authorizeExactTestJ1LifecycleDispatch/);
  assert.match(dispatcher, /event\."id" = \$\{eventId\}/);
  assert.match(dispatcher, /sequence" < event\."sequence"/);
  assert.match(dispatcher, /test_j1\.contact_values_verified/);
  assert.match(dispatcher, /TEST_J1_CONTACT_VALUES_STALE_OR_UNVERIFIED/);
  assert.match(service, /JSON\.stringify\(payload\.snapshot\) !== JSON\.stringify\(current\.snapshot\)/);
  assert.match(service, /exact\.allowedEventIds/);
  assert.match(service, /TEST_J1_CONTACT_DISPATCH_CONFIRMATION/);
  assert.match(service, /TEST_J1_JOURNEY_DISPATCH_CONFIRMATION/);
});

test("partial failures cannot bypass durable status, audit, or duplicate journey protections", async () => {
  const dispatcher = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(dispatcher, /UNCERTAIN_PROVIDER_OUTCOME/);
  assert.match(dispatcher, /UNCERTAIN_CONTACT_SYNC_OUTCOME/);
  assert.match(dispatcher, /providerResult.*UNKNOWN/s);
  assert.match(dispatcher, /processingClaimId/);
  assert.match(dispatcher, /DISPATCH_FENCE_REJECTED/);
  assert.match(dispatcher, /status: "HELD"/);
});
