import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ZohoApiClientCore, ZohoApiError, ZohoOAuthTokenManager, parseSubscribeResult } from "../lib/zoho-api-core.ts";
import {
  ZOHO_BUILT_IN_FIELDS,
  ZOHO_CUSTOM_FIELDS,
  ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS,
  ZOHO_LISTSUBSCRIBE_FIELDS
} from "../lib/zoho-field-mapping.ts";
import { synchronizeFullFieldContact } from "../lib/zoho-full-contact-sync-core.ts";
import { executeZohoProviderWorkflow } from "../lib/zoho-dispatch-engine.ts";

const displayNames = [...ZOHO_BUILT_IN_FIELDS, ...ZOHO_CUSTOM_FIELDS.map(([name]) => name)];
const fields = displayNames.map((displayName, index) => ({
  allowedValues: null,
  dataType: "Text",
  displayName,
  fieldId: String(index + 1),
  fieldName: `FIELD_${index + 1}`
}));
const snapshot = Object.fromEntries(displayNames.map((name, index) => [
  name,
  name === "Lead Email" ? "approved@example.com" : name === "First Name" ? "Alex" : index
]));

function fullSync(overrides = {}) {
  let submitted = null;
  let writes = 0;
  const promise = synchronizeFullFieldContact({
    beforeWrite: () => { writes += 1; },
    fieldMappingVerified: true,
    getFields: async () => fields,
    getMembership: async () => ({ complete: true, listStatuses: [] }),
    listKey: "private-list",
    snapshot,
    subscribe: async (leadInfo) => {
      submitted = leadInfo;
      return { classification: "ACCEPTED_UNCONFIRMED", code: "0" };
    },
    topicId: "123456789",
    ...overrides
  });
  return { get submitted() { return submitted; }, get writes() { return writes; }, promise };
}

test("normal lifecycle contact sync sends the 24 supported display-name values with the numeric topic gate", async () => {
  const operation = fullSync();
  const result = await operation.promise;
  assert.equal(result.classification, "ACCEPTED_UNCONFIRMED");
  assert.equal(operation.writes, 1);
  assert.deepEqual(Object.keys(operation.submitted), ZOHO_LISTSUBSCRIBE_FIELDS);
  assert.equal(Object.keys(operation.submitted).length, 24);
  assert.equal(operation.submitted["Lead Email"], "approved@example.com");
  assert.equal(operation.submitted["First Name"], "Alex");
  for (const field of ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS) {
    assert.equal(Object.hasOwn(operation.submitted, field), false);
  }
});

test("listsubscribe sends the numeric topic and rejects an HTTP-200 application error", async () => {
  const calls = [];
  const replies = [
    new Response(JSON.stringify({ access_token: "token", expires_in: 3600 })),
    new Response(JSON.stringify({ code: "2001", status: "error", message: "Invalid field value" }))
  ];
  const fetcher = async (url, init) => {
    calls.push({ init, url: String(url) });
    return replies.shift();
  };
  const client = new ZohoApiClientCore(
    new ZohoOAuthTokenManager({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" }, fetcher),
    fetcher
  );
  await assert.rejects(
    client.subscribeLead({ leadInfo: { "Lead Email": "approved@example.com" }, listKey: "private-list", topicId: "123456789" }),
    (error) => error instanceof ZohoApiError && error.kind === "PROVIDER" && error.options.providerCode === "2001"
  );
  const body = calls[1].init.body;
  assert.equal(body.get("topic_id"), "123456789");
  assert.equal(body.get("listkey"), "private-list");
});

test("listsubscribe accepts code zero only with an application-level success status", async () => {
  const calls = [];
  const replies = [
    new Response(JSON.stringify({ access_token: "token", expires_in: 3600 })),
    new Response(JSON.stringify({ code: "0", status: "success" }))
  ];
  const fetcher = async (url, init) => {
    calls.push({ init, url: String(url) });
    return replies.shift();
  };
  const client = new ZohoApiClientCore(
    new ZohoOAuthTokenManager({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" }, fetcher),
    fetcher
  );
  const leadInfo = Object.fromEntries(ZOHO_LISTSUBSCRIBE_FIELDS.map((field, index) => [field, index]));
  const result = await client.subscribeLead({
    leadInfo,
    listKey: "private-list",
    topicId: "1329658000000062845"
  });
  assert.equal(result.classification, "ACCEPTED_UNCONFIRMED");
  assert.equal(result.code, "0");
  assert.deepEqual(JSON.parse(calls[1].init.body.get("leadinfo")), leadInfo);
  assert.equal(calls[1].init.body.get("sources"), "Onboarding Portal");
  assert.equal(calls[1].init.body.get("resfmt"), "JSON");
});

test("listsubscribe does not accept an undocumented alternative success code", () => {
  assert.throws(
    () => parseSubscribeResult({ code: "200", status: "success" }),
    (error) => error instanceof ZohoApiError && error.kind === "PROVIDER"
  );
});

test("existing active contacts still receive full-field updates", async () => {
  const operation = fullSync({
    getMembership: async () => ({ complete: true, listStatuses: ["active"] })
  });
  await operation.promise;
  assert.equal(operation.writes, 1);
  assert.equal(operation.submitted["Lead Email"], "approved@example.com");
});

test("missing topic, unverified fields, incomplete scans, and suppressed recipients fail before a write", async () => {
  const cases = [
    { topicId: "" },
    { fieldMappingVerified: false },
    { getFields: async () => fields.slice(1) },
    { getMembership: async () => ({ complete: false, listStatuses: [] }) },
    { getMembership: async () => ({ complete: true, listStatuses: ["unsub"] }) },
    { getMembership: async () => ({ complete: true, listStatuses: ["bounce"] }) }
  ];
  for (const overrides of cases) {
    const operation = fullSync(overrides);
    await assert.rejects(operation.promise, (error) => error instanceof ZohoApiError);
    assert.equal(operation.writes, 0);
  }
});

test("verification-only handling never repeats an earlier email-only provider write", async () => {
  const verified = fullSync({
    getMembership: async () => ({ complete: true, listStatuses: ["active"] }),
    verificationOnly: true
  });
  assert.equal((await verified.promise).classification, "VERIFIED");
  assert.equal(verified.writes, 0);

  const pending = fullSync({ verificationOnly: true });
  assert.equal((await pending.promise).classification, "PENDING_VERIFICATION");
  assert.equal(pending.writes, 0);
});

test("J1 never triggers when listsSubscribe reports confirmation is still pending", async () => {
  let journeyCalls = 0;
  const result = await executeZohoProviderWorkflow({
    journey: { journeyKey: "test-j1", leadEmail: "approved@example.com", listKey: "private-list", triggerKey: "test-trigger" },
    provider: {
      async synchronizeContact() { return { classification: "PENDING_CONFIRMATION", code: "0" }; },
      async triggerJourney() { journeyCalls += 1; return { classification: "TRIGGERED", code: "200" }; }
    },
    snapshot
  });
  assert.equal(journeyCalls, 0);
  assert.equal(result.journey, null);
});

test("allowlisted test enrollment persists complete people data and atomically reserves contact then J1", async () => {
  const [persistence, lifecycle, route, ui, dispatcher, phase2, pilot] = await Promise.all([
    readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/msps/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-phase2.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-single-contact-pilot.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  for (const field of ["primaryContactFirstName", "primaryContactLastName", "assignedSeEmail", "assignedSeBookingUrl"]) {
    assert.match(persistence, new RegExp(field));
    assert.match(ui, new RegExp(field));
  }
  assert.ok(lifecycle.indexOf("recordZohoContactSyncEvents") < lifecycle.indexOf("recordZohoJourneyEvents"));
  assert.match(lifecycle, /allowedPlanIds\.size === 1/);
  assert.match(lifecycle, /allowedEmails\.size === 1/);
  assert.match(lifecycle, /SUBSCRIPTION_NOT_VERIFIED|journeyHeldForSubscription/);
  assert.match(lifecycle, /createStableZohoKey\(\s*"journey"/);
  assert.match(phase2, /status: "PENDING"/);
  assert.match(dispatcher, /UNCERTAIN_CONTACT_SYNC_OUTCOME/);
  assert.match(dispatcher, /getZohoTestJourneyConfiguration/);
  assert.match(pilot, /addLeadsInBulk/);
  assert.doesNotMatch(pilot, /subscribeLead/);
});

test("example environment remains dormant and test J1 keys are distinct configuration", async () => {
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  for (const setting of [
    "ZOHO_GLOBAL_KILL_SWITCH=true",
    "ZOHO_EVENT_EMISSION_ENABLED=false",
    "ZOHO_CONTACT_SYNC_ENABLED=false",
    "ZOHO_JOURNEY_TRIGGERING_ENABLED=false",
    "ZOHO_AUTOMATIC_DISPATCH_ENABLED=false",
    "ZOHO_TEST_SYNC_ENABLED=false"
  ]) assert.match(env, new RegExp(setting));
  assert.match(env, /ZMA_TEST_J1_JOURNEY_KEY=/);
  assert.match(env, /ZMA_TEST_J1_TRIGGER_KEY=/);
});
