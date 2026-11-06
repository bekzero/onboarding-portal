import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ZohoApiClientCore,
  ZohoApiError,
  ZohoOAuthTokenManager,
  parseTriggerResult
} from "../lib/zoho-api-core.ts";
import {
  evaluateJourneyApplicability,
  getZohoRetryDelayMs,
  isUncertainJourneyFailure
} from "../lib/zoho-dispatch-rules.ts";
import { executeZohoProviderWorkflow } from "../lib/zoho-dispatch-engine.ts";

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function base(journey, overrides = {}) {
  return {
    automationState: "ACTIVE",
    currentTask: { owner: "msp", status: "waiting_on_msp", templateKey: journey === "J1" ? "book-kickoff" : "partner-action" },
    eventTaskKey: journey === "J1" ? "book-kickoff" : "partner-action",
    journey,
    kickoffBooked: false,
    nudgeStatus: journey === "J3_R1" ? "WAITING" : "NONE",
    nudgeTaskKey: journey === "J3_R1" ? "partner-action" : null,
    tenantType: journey === "J8" ? "nfr" : "customer",
    j8Approved: journey === "J8",
    milestoneCompleted: journey === "J8",
    ...(journey === "J8" ? { eventTaskKey: "complete-first-customer-rollout" } : {}),
    ...overrides
  };
}

test("A-C: current J1, J5, and approved NFR J8 events remain applicable", () => {
  assert.equal(evaluateJourneyApplicability(base("J1")).applicable, true);
  assert.equal(evaluateJourneyApplicability(base("J5")).applicable, true);
  assert.equal(evaluateJourneyApplicability(base("J8")).applicable, true);
});

test("A-B: mock provider performs a full contact-upsert-before-trigger workflow", async () => {
  const calls = [];
  const provider = {
    async synchronizeContact() { calls.push("contact"); return { classification: "ACCEPTED_UNCONFIRMED", code: "0" }; },
    async triggerJourney() { calls.push("journey"); return { classification: "TRIGGERED", code: "200" }; }
  };
  const result = await executeZohoProviderWorkflow({
    provider,
    snapshot: {},
    journey: { journeyKey: "test-j1", leadEmail: "test@kzero.com", listKey: "list", triggerKey: "trigger" }
  });
  assert.deepEqual(calls, ["contact", "journey"]);
  assert.equal(result.journey.classification, "TRIGGERED");
});

test("G: a mock contact failure prevents the journey call", async () => {
  let triggerCalls = 0;
  const provider = {
    async synchronizeContact() { throw new Error("contact failed"); },
    async triggerJourney() { triggerCalls += 1; return { classification: "TRIGGERED", code: "200" }; }
  };
  await assert.rejects(executeZohoProviderWorkflow({
    provider,
    snapshot: {},
    journey: { journeyKey: "test-j1", leadEmail: "test@kzero.com", listKey: "list", triggerKey: "trigger" }
  }), /contact failed/);
  assert.equal(triggerCalls, 0);
});

test("N-O: delayed J3 and J5 are cancelled after the partner task completes", () => {
  assert.equal(evaluateJourneyApplicability(base("J3_R1", { currentTask: { owner: "msp", status: "complete", templateKey: "partner-action" } })).reason, "J3_TASK_NO_LONGER_ACTIONABLE");
  assert.equal(evaluateJourneyApplicability(base("J5", { currentTask: { owner: "msp", status: "complete", templateKey: "partner-action" } })).reason, "J5_HANDOFF_NO_LONGER_ACTIONABLE");
});

test("P-Q: paused starts are rejected while stop-state events are separately marked", async () => {
  assert.equal(evaluateJourneyApplicability(base("J3_R1", { automationState: "PAUSED" })).reason, "PLAN_NOT_AUTOMATION_ACTIVE");
  const lifecycle = await readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8");
  const persistence = await readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8");
  assert.match(lifecycle, /isStopState: input\.isStopState/);
  assert.match(persistence, /isStopState: finishNudge \|\| metrics\.status === "complete"/);
});

test("R: authoritative applicability ignores an old snapshot when current state changed", () => {
  assert.equal(evaluateJourneyApplicability(base("J1", { kickoffBooked: true })).reason, "J1_KICKOFF_ALREADY_BOOKED");
});

test("J: ignored_leads is distinct from accepted triggering", () => {
  assert.equal(parseTriggerResult({ code: "200", status: "success", triggered_leads: [], already_triggered: [], ignored_leads: ["test@kzero.com"] }, "test@kzero.com").classification, "IGNORED");
});

test("I: already_triggered is retained as its own outcome", () => {
  assert.equal(parseTriggerResult({ code: "200", status: "success", triggered_leads: [], already_triggered: ["test@kzero.com"], ignored_leads: [] }, "test@kzero.com").classification, "ALREADY_TRIGGERED");
});

test("normal Trigger Leads response is accepted only for the requested lead", () => {
  assert.equal(parseTriggerResult({ code: "200", status: "success", triggered_leads: ["test@kzero.com"], already_triggered: [], ignored_leads: [] }, "test@kzero.com").classification, "TRIGGERED");
  assert.throws(() => parseTriggerResult({ code: "200", status: "success", triggered_leads: [], already_triggered: [], ignored_leads: [] }, "test@kzero.com"), (error) => error instanceof ZohoApiError && error.kind === "INVALID_RESPONSE");
});

test("K: invalid and inactive journey codes are configuration blockers", async () => {
  for (const [code, expected] of [["9002", "INVALID_JOURNEY"], ["9006", "INACTIVE_JOURNEY"]]) {
    const replies = [response({ access_token: "token" }), response({ code, message: "blocked" }, 400)];
    const fetcher = async () => replies.shift();
    const client = new ZohoApiClientCore(new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetcher), fetcher);
    await assert.rejects(client.triggerJourney({ journeyKey: "j", leadEmail: "test@kzero.com", listKey: "l", triggerKey: "t" }), (error) => error.kind === expected);
  }
});

test("Trigger Leads uses documented details encoding without putting credentials in the URL", async () => {
  const calls = [];
  const replies = [response({ access_token: "token" }), response({ code: "200", status: "success", triggered_leads: ["test@kzero.com"], already_triggered: [], ignored_leads: [] })];
  const fetcher = async (input, init) => { calls.push({ input: String(input), init }); return replies.shift(); };
  const client = new ZohoApiClientCore(new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetcher), fetcher);
  await client.triggerJourney({ journeyKey: "journey", leadEmail: "test@kzero.com", listKey: "list", triggerKey: "trigger" });
  assert.match(calls[1].input, /\/api\/v1\/journeys\/journey\/action\/trigger\?details=/);
  assert.doesNotMatch(calls[1].input, /token|secret|refresh/);
});

test("L: backoff is bounded and Retry-After takes precedence", () => {
  assert.equal(getZohoRetryDelayMs(1), 60_000);
  assert.equal(getZohoRetryDelayMs(2), 300_000);
  assert.equal(getZohoRetryDelayMs(3), 900_000);
  assert.equal(getZohoRetryDelayMs(99), 3_600_000);
  assert.equal(getZohoRetryDelayMs(1, 1800), 1_800_000);
});

test("H: timeouts and ambiguous provider results are uncertain and not safe to retry", () => {
  assert.equal(isUncertainJourneyFailure("TIMEOUT"), true);
  assert.equal(isUncertainJourneyFailure("INVALID_RESPONSE"), true);
  assert.equal(isUncertainJourneyFailure("PROVIDER"), true);
  assert.equal(isUncertainJourneyFailure("RATE_LIMIT"), false);
});

test("D-F, S: source uses database recipient leases, fences, ordering, and dedupe ledger checks", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(source, /processingLeaseExpiresAt/);
  assert.match(source, /version: claim\.contextVersion/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /earlier\."sequence" < event\."sequence"/);
  assert.match(source, /\["TRIGGERED", "ALREADY_TRIGGERED", "UNKNOWN"\]/);
  assert.match(source, /PROCESSING_LEASE_EXPIRED_OUTCOME_UNCERTAIN/);
});

test("G, M: contact failure/suppression block the trigger path", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/zoho-dispatch-engine.ts", import.meta.url), "utf8");
  assert.ok(engine.indexOf("synchronizeContact") < engine.indexOf("triggerJourney"));
  assert.match(source, /subscriptionStatus === "INELIGIBLE"/);
  assert.match(source, /CRITICAL_STOP_STATE_RECIPIENT_SUPPRESSED/);
});

test("T-U: kill switch and allowlists are checked before provider calls", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("config.globalKillSwitch") < source.lastIndexOf("executeZohoProviderWorkflow"));
  assert.ok(source.indexOf("TEST_TARGET_NOT_ALLOWLISTED") < source.lastIndexOf("executeZohoProviderWorkflow"));
});

test("V: cron and manual dispatcher endpoints require independent authorization", async () => {
  const cron = await readFile(new URL("../app/api/cron/zoho-dispatch/route.ts", import.meta.url), "utf8");
  const manual = await readFile(new URL("../app/api/admin/zoho/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(cron, /timingSafeEqual/);
  assert.match(cron, /Authorization|authorization/);
  assert.match(cron, /automaticDispatchEnabled/);
  assert.match(manual, /getAdminApiAuthError\(\)/);
  assert.match(manual, /DISPATCH ALLOWLISTED ZOHO TEST EVENTS/);
});

test("production flags and cron remain disabled in the example environment", async () => {
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(env, /ZOHO_GLOBAL_KILL_SWITCH=true/);
  assert.match(env, /ZOHO_CONTACT_SYNC_ENABLED=false/);
  assert.match(env, /ZOHO_JOURNEY_TRIGGERING_ENABLED=false/);
  assert.match(env, /ZOHO_AUTOMATIC_DISPATCH_ENABLED=false/);
  assert.match(env, /ZOHO_PRODUCTION_DISPATCH_APPROVED=false/);
  assert.match(env, /ZOHO_DISPATCH_MODE=disabled/);
});

test("no Vercel cron schedule was introduced", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(packageJson, /test:zoho-phase-4/);
  await assert.rejects(readFile(new URL("../vercel.json", import.meta.url), "utf8"), /ENOENT/);
});
