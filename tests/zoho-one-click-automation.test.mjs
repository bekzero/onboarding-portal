import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyContactDispatchResult,
  isVerifiedJourneyContactDependency
} from "../lib/zoho-automatic-dispatch-core.ts";
import {
  getZohoProductionRolloutConfiguration,
  isZohoProductionJourneyEnabled,
  isZohoProductionRolloutPlanAllowed
} from "../lib/zoho-production-rollout.ts";
import { validateEnrollmentSubscriptionAuthorization } from "../lib/zoho-subscription-authorization.ts";

test("Production rollout allowlists plans and journeys exactly and defaults closed", () => {
  const previousPlans = process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
  const previousJourneys = process.env.ZMA_AUTOMATED_JOURNEYS;
  try {
    delete process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
    delete process.env.ZMA_AUTOMATED_JOURNEYS;
    assert.equal(getZohoProductionRolloutConfiguration().allowedPlanIds.size, 0);
    assert.equal(getZohoProductionRolloutConfiguration().enabledJourneys.size, 0);

    process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS = "approved-nfr, second-nfr";
    process.env.ZMA_AUTOMATED_JOURNEYS = "J1,J5,unknown";
    assert.equal(isZohoProductionRolloutPlanAllowed("approved-nfr"), true);
    assert.equal(isZohoProductionRolloutPlanAllowed("unrelated-nfr"), false);
    assert.equal(isZohoProductionJourneyEnabled("J1"), true);
    assert.equal(isZohoProductionJourneyEnabled("J3_R1"), false);
  } finally {
    if (previousPlans === undefined) delete process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
    else process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS = previousPlans;
    if (previousJourneys === undefined) delete process.env.ZMA_AUTOMATED_JOURNEYS;
    else process.env.ZMA_AUTOMATED_JOURNEYS = previousJourneys;
  }
});

test("provider acceptance is retried read-only until active membership is verified", () => {
  assert.deepEqual(classifyContactDispatchResult("ACCEPTED_UNCONFIRMED", 1, 5), {
    outcome: "ACCEPTED_PENDING_VERIFICATION",
    reason: "CONTACT_MEMBERSHIP_PENDING_VERIFICATION",
    state: "RETRY"
  });
  assert.equal(classifyContactDispatchResult("VERIFIED", 2, 5).state, "SUCCEEDED");
  assert.equal(classifyContactDispatchResult("PENDING_CONFIRMATION", 1, 5).state, "HELD");
  assert.equal(classifyContactDispatchResult("UNRECOGNIZED", 1, 5).state, "HELD");
  assert.equal(classifyContactDispatchResult("PENDING_VERIFICATION", 5, 5).state, "HELD");
});

test("J1 requires the exact earlier verified contact event and current snapshot", () => {
  const journeyEvent = {
    onboardingPlanId: "plan-db-id",
    recipientEmailNormalized: "owner@example.test",
    sequence: 2n
  };
  const contactEvent = {
    eventType: "UPSERT_CONTACT",
    lastProviderOutcome: "VERIFIED",
    onboardingPlanId: "plan-db-id",
    recipientEmailNormalized: "owner@example.test",
    sequence: 1n,
    status: "SUCCEEDED"
  };
  assert.equal(isVerifiedJourneyContactDependency({ contactEvent, journeyEvent, snapshotMatches: true }), true);
  assert.equal(isVerifiedJourneyContactDependency({ contactEvent: { ...contactEvent, lastProviderOutcome: "ACCEPTED_UNCONFIRMED" }, journeyEvent, snapshotMatches: true }), false);
  assert.equal(isVerifiedJourneyContactDependency({ contactEvent, journeyEvent, snapshotMatches: false }), false);
  assert.equal(isVerifiedJourneyContactDependency({ contactEvent: { ...contactEvent, recipientEmailNormalized: "other@example.test" }, journeyEvent, snapshotMatches: true }), false);
});

test("enrollment subscription authorization is explicit and evidence backed", () => {
  assert.equal(validateEnrollmentSubscriptionAuthorization().confirmed, false);
  assert.equal(validateEnrollmentSubscriptionAuthorization({ confirmed: true }).valid, false);
  assert.equal(validateEnrollmentSubscriptionAuthorization({
    authorizationBasis: "The contact expressly authorized onboarding email communication.",
    confirmed: true,
    evidenceReference: "CRM consent record 123"
  }).valid, true);
});

test("schedule, claiming, dispatch, enrollment and legacy protections remain fail closed", async () => {
  const [cron, schedule, dispatcher, foundation, route, persistence, vercel, legacy] = await Promise.all([
    readFile(new URL("../app/api/cron/zoho-dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../api/zoho-dispatch-schedule.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/msps/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-legacy-eligibility.ts", import.meta.url), "utf8")
  ]);
  assert.match(cron, /timingSafeEqual/);
  assert.match(cron, /automaticDispatchEnabled/);
  assert.match(schedule, /handleSchedule/);
  assert.match(schedule, /automaticDispatchEnabled/);
  assert.match(schedule, /dispatchZohoOutboxBatch/);
  assert.doesNotMatch(schedule, /CRON_SECRET|authorization/i);
  const configuration = JSON.parse(vercel);
  assert.equal(configuration.crons, undefined);
  assert.deepEqual(configuration.schedules["zoho-automatic-dispatch"], {
    function: "api/zoho-dispatch-schedule",
    jitter: 15,
    schedule: "*/15 * * * *",
    timezone: "UTC"
  });
  assert.deepEqual(
    configuration.functions["api/zoho-dispatch-schedule.ts"].experimentalTriggers,
    [{ type: "schedule/v1beta" }]
  );
  assert.match(dispatcher, /event\."planId" IN/);
  assert.match(dispatcher, /PRODUCTION_ROLLOUT_NOT_APPROVED/);
  assert.match(dispatcher, /JOURNEY_NOT_IN_PRODUCTION_ROLLOUT/);
  assert.match(dispatcher, /CONTACT_SYNC_NOT_VERIFIED_FOR_JOURNEY/);
  assert.match(foundation, /PRODUCTION_ROLLOUT_NOT_APPROVED/);
  assert.match(route, /zohoSubscriptionAuthorization/);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(persistence, /msp_enrollment\.subscription_authorization_recorded/);
  assert.match(legacy, /LEGACY_AUTOMATION_BLOCK_REASON/);
});

test("routine journey events link to their preceding contact snapshots", async () => {
  const [lifecycle, persistence, nudge] = await Promise.all([
    readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-nudge-engine.ts", import.meta.url), "utf8")
  ]);
  assert.match(lifecycle, /dependsOnContactEventId/);
  assert.match(persistence, /dependsOnContactEventId/);
  assert.match(nudge, /dependsOnContactEventId/);
});
