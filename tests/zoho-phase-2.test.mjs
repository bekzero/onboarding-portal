import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ZohoApiClientCore,
  ZohoApiError,
  ZohoOAuthTokenManager,
  classifyZohoListMembership,
  parseJourneys,
  parseSubscribeResult
} from "../lib/zoho-api-core.ts";
import {
  ZOHO_CONTACT_ROLES,
  ZOHO_NUDGE_STATUSES,
  ZOHO_ONBOARDING_STATES,
  ZOHO_PHASES,
  ZOHO_TASK_OWNERS,
  ZOHO_TASK_STATUSES,
  ZOHO_TENANT_TYPES,
  ZohoContactMappingError,
  createZohoContactSnapshot
} from "../lib/zoho-contact-mapping.ts";
import {
  ZOHO_BUILT_IN_FIELDS,
  ZOHO_CUSTOM_FIELDS,
  buildZohoFieldDiscoveryReport,
  buildZohoLeadInfo
} from "../lib/zoho-field-mapping.ts";
import { getTaskTimeEstimateMinutes } from "../lib/onboarding-time-estimates.ts";
import { evaluateZohoTestPolicy } from "../lib/zoho-test-policy.ts";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", ...headers },
    status
  });
}

function sequenceFetch(responses, calls = []) {
  return async (input, init) => {
    calls.push({ input: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return typeof next === "function" ? next(input, init) : next;
  };
}

function baseSnapshotInput(overrides = {}) {
  return {
    appsApproved: 1,
    appsSubmitted: 2,
    contact: {
      email: "test.user@kzero.com",
      firstName: "Test",
      lastName: "User",
      role: "ONBOARDING_OWNER"
    },
    kickoffBookedAt: null,
    lastMspActivity: new Date("2026-11-01T10:00:00.000Z"),
    lastSeTouch: null,
    nextTask: {
      guideUrl: "https://partners.kzero.com/guide",
      minutes: 5,
      owner: "msp",
      since: new Date("2026-11-02T10:00:00.000Z"),
      status: "waiting_on_msp",
      templateKey: "book-kickoff",
      tip: null,
      title: "Book Setup Call"
    },
    nudgeStatus: "NONE",
    plan: {
      currentStage: "Kickoff",
      planId: "test-nfr",
      progress: 10,
      status: "in_progress",
      tenantType: "nfr"
    },
    portalBaseUrl: "https://onboarding.kzero.com",
    salesEngineer: {
      bookingUrl: "https://outlook.office.com/book/test",
      email: "se@kzero.com",
      name: "Test Engineer"
    },
    ...overrides
  };
}

function discoveredFields() {
  return [...ZOHO_BUILT_IN_FIELDS, ...ZOHO_CUSTOM_FIELDS.map(([name]) => name)].map((displayName, index) => ({
    dataType: null,
    displayName,
    fieldId: String(index + 1),
    fieldName: displayName.toLowerCase().replaceAll(" ", "_")
  }));
}

test("OAuth refresh is cached and secrets stay in the form body", async () => {
  const calls = [];
  const fetchImpl = sequenceFetch([jsonResponse({
    access_token: "access-one",
    api_domain: "https://www.zohoapis.com",
    expires_in: 3600,
    scope: "ZohoMarketingAutomation.lead.READ",
    token_type: "Bearer"
  })], calls);
  const manager = new ZohoOAuthTokenManager(
    { clientId: "client", clientSecret: "secret", refreshToken: "refresh" },
    fetchImpl
  );
  assert.equal(await manager.getAccessToken(), "access-one");
  assert.equal(await manager.getAccessToken(), "access-one");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://accounts.zoho.com/oauth/v2/token");
  assert.match(String(calls[0].init.body), /grant_type=refresh_token/);
  assert.doesNotMatch(JSON.stringify(calls[0].init.headers), /secret|refresh/);
  assert.deepEqual(manager.getLastRefreshDiagnostic(), {
    apiDomain: "https://www.zohoapis.com",
    grantedScope: "ZohoMarketingAutomation.lead.READ",
    responseKeys: ["api_domain", "expires_in", "scope"],
    tokenType: "Bearer"
  });
});

test("missing OAuth credentials are rejected without a network call", async () => {
  const manager = new ZohoOAuthTokenManager({ clientId: "", clientSecret: "", refreshToken: "" });
  await assert.rejects(manager.getAccessToken(), (error) => error instanceof ZohoApiError && error.kind === "CONFIGURATION");
});

test("expired access tokens refresh and rejected API tokens retry once", async () => {
  let now = 0;
  const expiryCalls = [];
  const expiryManager = new ZohoOAuthTokenManager(
    { clientId: "c", clientSecret: "s", refreshToken: "r" },
    sequenceFetch([
      jsonResponse({ access_token: "first", expires_in: 3600 }),
      jsonResponse({ access_token: "second", expires_in: 3600 })
    ], expiryCalls),
    () => now
  );
  assert.equal(await expiryManager.getAccessToken(), "first");
  now = 3_600_001;
  assert.equal(await expiryManager.getAccessToken(), "second");

  const responses = [
    jsonResponse({ access_token: "old", expires_in: 3600 }),
    jsonResponse({ code: "401", message: "expired" }, 401),
    jsonResponse({ access_token: "new", expires_in: 3600 }),
    jsonResponse({ response: { code: "0", fieldname: [] } })
  ];
  const sharedFetch = sequenceFetch(responses);
  const manager = new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, sharedFetch);
  const client = new ZohoApiClientCore(manager, sharedFetch);
  assert.deepEqual(await client.getAllLeadFields(), []);
});

test("timeouts and rate limits are classified without retry loops", async () => {
  const timeoutManager = new ZohoOAuthTokenManager(
    { clientId: "c", clientSecret: "s", refreshToken: "r" },
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    Date.now,
    5
  );
  await assert.rejects(timeoutManager.getAccessToken(), (error) => error instanceof ZohoApiError && error.kind === "TIMEOUT");

  const responses = [
    jsonResponse({ access_token: "token", expires_in: 3600 }),
    jsonResponse({ code: "2008", message: "Calls limit exceeded" }, 429, { "retry-after": "1800" })
  ];
  const fetchImpl = sequenceFetch(responses);
  const manager = new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchImpl);
  const client = new ZohoApiClientCore(manager, fetchImpl);
  await assert.rejects(
    client.getAllLeadFields(),
    (error) => error instanceof ZohoApiError && error.kind === "RATE_LIMIT" && error.options.retryAfterSeconds === 1800
  );
});

test("invalid JSON and provider email/topic errors are classified safely", async () => {
  const invalidFetch = sequenceFetch([
    jsonResponse({ access_token: "token", expires_in: 3600 }),
    new Response("not-json", { status: 200 })
  ]);
  const invalidManager = new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, invalidFetch);
  await assert.rejects(
    new ZohoApiClientCore(invalidManager, invalidFetch).getAllLeadFields(),
    (error) => error instanceof ZohoApiError && error.kind === "INVALID_RESPONSE"
  );

  for (const [payload, expected] of [
    [{ code: "2005", message: "Group email address added" }, "GROUP_EMAIL"],
    [{ code: "2007", message: "Invalid topic_id" }, "INVALID_TOPIC"]
  ]) {
    const fetchImpl = sequenceFetch([
      jsonResponse({ access_token: "token", expires_in: 3600 }),
      jsonResponse(payload, 400)
    ]);
    const manager = new ZohoOAuthTokenManager({ clientId: "c", clientSecret: "s", refreshToken: "r" }, fetchImpl);
    const client = new ZohoApiClientCore(manager, fetchImpl);
    await assert.rejects(
      client.subscribeLead({ leadInfo: { lead_email: "test@kzero.com" }, listKey: "list", topicId: "topic" }),
      (error) => error instanceof ZohoApiError && error.kind === expected
    );
  }
});

test("contact mapping preserves every approved picklist spelling", () => {
  assert.deepEqual(ZOHO_TENANT_TYPES, ["NFR", "Customer"]);
  assert.deepEqual(ZOHO_PHASES, ["Kickoff", "Tenant Setup", "App Review", "SSO Rollout", "First Customer Pilot", "Onboarding Complete"]);
  assert.deepEqual(ZOHO_CONTACT_ROLES, ["Onboarding Owner", "Executive Sponsor", "Technical Admin"]);
  assert.deepEqual(ZOHO_ONBOARDING_STATES, ["Active", "Paused", "Complete"]);
  assert.deepEqual(ZOHO_TASK_OWNERS, ["MSP", "KZero SE", "Shared"]);
  assert.deepEqual(ZOHO_TASK_STATUSES, ["Action Required", "In Progress", "KZero Working", "Upcoming", "Complete"]);
  assert.deepEqual(ZOHO_NUDGE_STATUSES, ["Waiting", "Done"]);
});

test("contact snapshots map dates, roles, statuses, nudge state, and kickoff override", () => {
  const snapshot = createZohoContactSnapshot(baseSnapshotInput());
  assert.equal(snapshot["Tenant Type"], "NFR");
  assert.equal(snapshot["Current Phase"], "Kickoff");
  assert.equal(snapshot["Onboarding Role"], "Onboarding Owner");
  assert.equal(snapshot["Onboarding State"], "Active");
  assert.equal(snapshot["Next Task Owner"], "MSP");
  assert.equal(snapshot["Next Task Status"], "Action Required");
  assert.equal(snapshot["Nudge Status"], "Done");
  assert.equal(snapshot["Next Task Since"], "2026-11-02T10:00:00.000Z");
  assert.match(String(snapshot["Next Task Link"]), /\?tab=tasks&task=book-kickoff$/);

  const booked = createZohoContactSnapshot(baseSnapshotInput({ kickoffBookedAt: new Date("2026-11-03T00:00:00Z") }));
  assert.equal(booked["Next Task Status"], "Upcoming");
  const waiting = createZohoContactSnapshot(baseSnapshotInput({ nudgeStatus: "WAITING" }));
  assert.equal(waiting["Nudge Status"], "Waiting");
});

test("all portal task status and owner values map exactly", () => {
  const statuses = {
    waiting_on_msp: "Action Required",
    in_progress: "In Progress",
    waiting_on_kzero: "KZero Working",
    not_started: "Upcoming",
    complete: "Complete"
  };
  for (const [portalStatus, expected] of Object.entries(statuses)) {
    const input = baseSnapshotInput();
    input.nextTask = { ...input.nextTask, status: portalStatus, templateKey: "another-task" };
    assert.equal(createZohoContactSnapshot(input)["Next Task Status"], expected);
  }
  for (const [owner, expected] of Object.entries({ msp: "MSP", kzero_se: "KZero SE", shared: "Shared" })) {
    const input = baseSnapshotInput();
    input.nextTask = { ...input.nextTask, owner };
    assert.equal(createZohoContactSnapshot(input)["Next Task Owner"], expected);
  }
});

test("missing required mapping data and unknown estimates are not fabricated", () => {
  const input = baseSnapshotInput();
  input.contact = { ...input.contact, firstName: null };
  assert.throws(() => createZohoContactSnapshot(input), (error) => error instanceof ZohoContactMappingError && error.field === "First Name");
  assert.equal(getTaskTimeEstimateMinutes("review-app-compatibility-prepare-onboarding-plan"), null);
  assert.equal(getTaskTimeEstimateMinutes("book-sso-implementation-session"), null);
  assert.equal(getTaskTimeEstimateMinutes("unknown-task"), null);
  assert.equal(getTaskTimeEstimateMinutes("submit-saas-applications-for-review"), 10);
});

test("field discovery blocks missing or ambiguous custom identifiers", () => {
  const fields = discoveredFields();
  const ready = buildZohoFieldDiscoveryReport(fields);
  assert.equal(ready.length, 24);
  assert.ok(ready.every((field) => field.mappingStatus === "FOUND_IDENTIFIER_TYPE_UNVERIFIED"));

  const incomplete = fields.filter((field) => field.displayName !== "Plan ID");
  assert.equal(buildZohoFieldDiscoveryReport(incomplete).find((field) => field.expectedField === "Plan ID").mappingStatus, "MISSING");
  assert.throws(() => buildZohoLeadInfo(createZohoContactSnapshot(baseSnapshotInput()), incomplete), /mapping is incomplete/i);
});

test("journey discovery accepts triggerkey and trigger_key variants", () => {
  const journeys = parseJourneys({
    journeys: [
      { journey_key: "j1", journey_name: "One", triggerkey: "t1" },
      { journey_key: "j2", journey_name: "Two", trigger_key: "t2" }
    ]
  });
  assert.deepEqual(journeys.map((item) => item.triggerKey), ["t1", "t2"]);
});

test("listsubscribe success remains pending and list suppression remains ineligible", () => {
  assert.equal(
    parseSubscribeResult({ code: "0", status: "success", message: "A confirmation email is sent to the user." }).classification,
    "PENDING_CONFIRMATION"
  );
  assert.equal(classifyZohoListMembership(["active"], false), "MANUAL_REVIEW");
  assert.equal(classifyZohoListMembership(["unsub"], false), "INELIGIBLE");
  assert.equal(classifyZohoListMembership(["bounce"], false), "INELIGIBLE");
});

test("test policy rejects arbitrary recipients and multi-plan conflicts", () => {
  const allowed = {
    competingActivePlanIds: [],
    contactAutomationEnabled: true,
    contextOwnedByPlan: true,
    contextState: "ACTIVE",
    emailAllowlisted: true,
    planAllowlisted: true,
    planAutomationState: "ACTIVE",
    subscriptionStatus: "UNKNOWN",
    testModeEnabled: true
  };
  assert.equal(evaluateZohoTestPolicy(allowed).allowed, true);
  assert.equal(evaluateZohoTestPolicy({ ...allowed, emailAllowlisted: false }).reason, "EMAIL_NOT_ALLOWLISTED");
  assert.equal(evaluateZohoTestPolicy({ ...allowed, competingActivePlanIds: ["other-plan"] }).reason, "MULTIPLE_ACTIVE_PLANS");
  assert.equal(evaluateZohoTestPolicy({ ...allowed, contextOwnedByPlan: false }).reason, "CONTEXT_NOT_ACTIVE");
  assert.equal(evaluateZohoTestPolicy({ ...allowed, subscriptionStatus: "INELIGIBLE" }).reason, "SUBSCRIPTION_BLOCKED");
});

test("every Phase 2 route performs the existing admin authorization check", async () => {
  const routes = [
    "status", "discover", "test-sync", "test-sync/preview", "subscription-check", "verify-subscription"
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/api/admin/zoho/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /getAdminApiAuthError\(/);
  }
});
