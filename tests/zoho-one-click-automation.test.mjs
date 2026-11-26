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
  getApprovedZohoRolloutOwner,
  getZohoRolloutEventOwnerId,
  isZohoProductionRolloutRecipientAllowed
} from "../lib/zoho-production-rollout.ts";
import { validateEnrollmentSubscriptionAuthorization } from "../lib/zoho-subscription-authorization.ts";

test("Production rollout requires the exact approved plan, primary email, owner and event recipient", async () => {
  const previousPlans = process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
  const previousEmail = process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL;
  const previousJourneys = process.env.ZMA_AUTOMATED_JOURNEYS;
  const email = "beneakinkzero@gmail.com";
  const planId = "kzeroautomatione2etest-nfr";
  const identity = { planId, primaryEmail: email.toUpperCase(), ownerEmail: email, recipientEmail: email };
  try {
    delete process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
    delete process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL;
    delete process.env.ZMA_AUTOMATED_JOURNEYS;
    assert.equal(getZohoProductionRolloutConfiguration().target, null);
    assert.equal(getZohoProductionRolloutConfiguration().enabledJourneys.size, 0);

    process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS = planId;
    assert.equal(isZohoProductionRolloutRecipientAllowed(identity), false);
    process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL = "wrong@example.test";
    assert.equal(isZohoProductionRolloutRecipientAllowed(identity), false);
    process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL = email;
    process.env.ZMA_AUTOMATED_JOURNEYS = "J1";
    assert.equal(isZohoProductionRolloutRecipientAllowed(identity), true);
    for (const key of ["primaryEmail", "ownerEmail", "recipientEmail"]) {
      assert.equal(isZohoProductionRolloutRecipientAllowed({ ...identity, [key]: "other@example.test" }), false);
    }
    assert.equal(isZohoProductionRolloutRecipientAllowed({ ...identity, planId: "benmspe2etest-nfr" }), false);
    assert.equal(isZohoProductionJourneyEnabled("J1"), true);
    assert.equal(isZohoProductionJourneyEnabled("J3_R1"), false);
    process.env.ZMA_AUTOMATED_JOURNEYS = "J1,J5";
    assert.equal(isZohoProductionJourneyEnabled("J1"), false);
    assert.equal(isZohoProductionJourneyEnabled("J5"), false);
    const owner = { id: "approved-owner", email, normalizedEmail: email, automationEnabled: true, subscriptionStatus: "CONFIRMED" };
    const approval = { action: "email_automation.enabled", actor: "oidc:admin", evidenceReference: owner.id, recipientEmailNormalized: email };
    const plan = { planId, msp: { primaryContactEmail: email }, planContacts: [owner], zohoAutomationAudits: [approval] };
    const lookup = (record) => ({ onboardingPlan: { findUnique: async () => record } });
    const target = { onboardingPlanId: "plan-db-id", planId, recipientEmail: email };
    assert.equal(await getApprovedZohoRolloutOwner(lookup(plan), target), owner.id);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, zohoLegacyAutomationProtection: {} }), target), null);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, planContacts: [] }), target), null);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, planContacts: [owner, owner] }), target), null);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, planContacts: [{ ...owner, id: "replacement-owner" }] }), target), null);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, planContacts: [{ ...owner, subscriptionStatus: "INELIGIBLE" }] }), target), null);
    assert.equal(await getApprovedZohoRolloutOwner(lookup({ ...plan, zohoAutomationAudits: [{ ...approval, action: "email_automation.disabled" }] }), target), null);
    assert.equal(getZohoRolloutEventOwnerId({ snapshot: { "Lead Email": email } }), null);
    process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS += ",other-plan";
    assert.equal(isZohoProductionRolloutRecipientAllowed(identity), false);
  } finally {
    if (previousPlans === undefined) delete process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS;
    else process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS = previousPlans;
    if (previousEmail === undefined) delete process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL;
    else process.env.ZOHO_PRODUCTION_ROLLOUT_EMAIL = previousEmail;
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
  assert.match(dispatcher, /event\."planId" = \$\{target\.planId\} AND event\."recipientEmailNormalized" = \$\{target\.email\}/);
  assert.match(dispatcher, /requireRollout && !await hasApprovedRolloutEventOwner\(transaction, event\)/);
  assert.match(dispatcher, /await assertApprovedRecipientBeforeWrite\(claim\.event\.recipientEmailNormalized\)/);
  assert.match(dispatcher, /await assertApprovedRecipientBeforeWrite\(String\(snapshot\.snapshot\["Lead Email"\]/);
  assert.match(dispatcher, /PRODUCTION_ROLLOUT_NOT_APPROVED/);
  assert.match(dispatcher, /JOURNEY_NOT_IN_PRODUCTION_ROLLOUT/);
  assert.match(dispatcher, /CONTACT_SYNC_NOT_VERIFIED_FOR_JOURNEY/);
  assert.match(foundation, /PRODUCTION_ROLLOUT_NOT_APPROVED/);
  assert.match(foundation, /payload = \{ \.\.\.payload, rolloutOwnerId: ownerId \}/);
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
