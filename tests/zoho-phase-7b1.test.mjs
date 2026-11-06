import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMailingLists, parseTopics } from "../lib/zoho-api-core.ts";
import { ZOHO_BUILT_IN_FIELDS, ZOHO_CUSTOM_FIELDS } from "../lib/zoho-field-mapping.ts";
import {
  PHASE7B1_EXPECTED_ORGANIZATION,
  PHASE7B1_JOURNEYS,
  PHASE7B1_READ_ONLY_AUTHORIZATION,
  assertPhase7b1ReadOnlyOperation,
  buildPhase7b1DiscoveryReport,
  evaluatePhase7b1Configuration
} from "../lib/zoho-phase7b1-readiness.ts";

function baseEnvironment() {
  return {
    ZOHO_CLIENT_ID: "configured",
    ZOHO_CLIENT_SECRET: "configured",
    ZOHO_REFRESH_TOKEN: "configured",
    ZOHO_PHASE7B1_EXPECTED_ORGANIZATION: PHASE7B1_EXPECTED_ORGANIZATION,
    ZOHO_PHASE7B1_ORGANIZATION_VERIFICATION_REFERENCE: "approved-evidence-reference",
    ZOHO_PHASE7B1_OAUTH_SCOPES: "ZohoMarketingAutomation.lead.READ,ZohoMarketingAutomation.lead.CREATE-UPDATE,ZohoMarketingAutomation.journey.READ",
    ZOHO_PHASE7B1_READ_ONLY_AUTHORIZATION: PHASE7B1_READ_ONLY_AUTHORIZATION,
    ZMA_LIST_KEY: "list-key",
    ZMA_TOPIC_ID: "topic-id",
    ZOHO_GLOBAL_KILL_SWITCH: "true",
    ZOHO_EVENT_EMISSION_ENABLED: "false",
    ZOHO_CONTACT_SYNC_ENABLED: "false",
    ZOHO_JOURNEY_TRIGGERING_ENABLED: "false",
    ZOHO_AUTOMATIC_DISPATCH_ENABLED: "false",
    ZOHO_PRODUCTION_DISPATCH_APPROVED: "false",
    ZOHO_DISPATCH_MODE: "disabled",
    ZMA_NUDGE_EVALUATION_ENABLED: "false",
    ZOHO_TEST_EMAIL_ALLOWLIST: "approved@internal.example",
    ZOHO_PHASE7B1_APPROVED_INTERNAL_EMAILS: "approved@internal.example",
    ...Object.fromEntries(Object.keys(PHASE7B1_JOURNEYS).flatMap((journey) => {
      const suffix = journey === "J3_R1" ? "J3" : journey;
      return [
        [`ZMA_${suffix}_JOURNEY_KEY`, `production-${journey}`],
        [`ZMA_${suffix}_TRIGGER_KEY`, `production-trigger-${journey}`],
        [`ZMA_TEST_${suffix}_JOURNEY_KEY`, `test-${journey}`],
        [`ZMA_TEST_${suffix}_TRIGGER_KEY`, `test-trigger-${journey}`]
      ];
    }))
  };
}

const expectedTypes = Object.fromEntries(ZOHO_CUSTOM_FIELDS);

function completeFields() {
  return [...ZOHO_BUILT_IN_FIELDS, ...ZOHO_CUSTOM_FIELDS.map(([name]) => name)].map((displayName, index) => ({
    allowedValues: displayName === "Tenant Type" ? ["NFR", "Customer"] : null,
    dataType: expectedTypes[displayName] ?? "Text",
    displayName,
    fieldId: String(index + 1),
    fieldName: displayName.toLowerCase().replaceAll(" ", "_")
  }));
}

function openJourneys(environment) {
  return Object.entries(PHASE7B1_JOURNEYS).flatMap(([journey, journeyName]) => {
    const suffix = journey === "J3_R1" ? "J3" : journey;
    return [
      { journeyKey: environment[`ZMA_${suffix}_JOURNEY_KEY`], journeyName, triggerKey: environment[`ZMA_${suffix}_TRIGGER_KEY`] },
      { journeyKey: environment[`ZMA_TEST_${suffix}_JOURNEY_KEY`], journeyName: `TEST ${journeyName}`, triggerKey: environment[`ZMA_TEST_${suffix}_TRIGGER_KEY`] }
    ];
  });
}

test("missing credentials and incorrect OAuth scopes block live verification", () => {
  const missing = evaluatePhase7b1Configuration({ ...baseEnvironment(), ZOHO_REFRESH_TOKEN: "" });
  assert.ok(missing.blockers.includes("MISSING_OAUTH_CREDENTIALS"));
  const scopes = evaluatePhase7b1Configuration({
    ...baseEnvironment(),
    ZOHO_PHASE7B1_OAUTH_SCOPES: "ZohoMarketingAutomation.lead.READ"
  });
  assert.ok(scopes.blockers.includes("MISSING_REQUIRED_OAUTH_SCOPES"));
  assert.deepEqual(scopes.missingScopes, ["ZohoMarketingAutomation.lead.UPDATE", "ZohoMarketingAutomation.journey.READ"]);
});

test("wrong organization or missing manual organization evidence fails closed", () => {
  assert.ok(evaluatePhase7b1Configuration({
    ...baseEnvironment(), ZOHO_PHASE7B1_EXPECTED_ORGANIZATION: "org-other"
  }).blockers.includes("WRONG_OR_UNCONFIRMED_ORGANIZATION"));
  assert.ok(evaluatePhase7b1Configuration({
    ...baseEnvironment(), ZOHO_PHASE7B1_ORGANIZATION_VERIFICATION_REFERENCE: ""
  }).blockers.includes("ORGANIZATION_EVIDENCE_REQUIRED"));
});

test("missing, ambiguous, and mistyped fields remain visible blockers", () => {
  const environment = baseEnvironment();
  const fields = completeFields()
    .filter((field) => field.displayName !== "Plan ID")
    .map((field) => field.displayName === "Portal URL" ? { ...field, dataType: "Integer" } : field);
  fields.push({ ...completeFields().find((field) => field.displayName === "Tenant Type"), fieldName: "tenant_type_2" });
  const report = buildPhase7b1DiscoveryReport({
    environment,
    fields,
    journeys: openJourneys(environment),
    lists: [{ isPublic: false, listKey: "list-key", listName: "KZero Partner Onboarding", owner: "owner" }],
    topics: [{ primaryList: null, topicId: "topic-id", topicName: "Partner Onboarding" }]
  });
  assert.ok(report.fields.missingOrAmbiguous.includes("Plan ID"));
  assert.ok(report.fields.missingOrAmbiguous.includes("Tenant Type"));
  assert.equal(report.fields.typeMismatchCount, 1);
});

test("picklist values are verified only when the provider actually returns them", () => {
  const environment = baseEnvironment();
  const report = buildPhase7b1DiscoveryReport({
    environment,
    fields: completeFields(),
    journeys: openJourneys(environment),
    lists: [{ isPublic: false, listKey: "list-key", listName: "KZero Partner Onboarding", owner: "owner" }],
    topics: [{ primaryList: null, topicId: "topic-id", topicName: "Partner Onboarding" }]
  });
  assert.equal(report.picklists.find((item) => item.fieldName === "Tenant Type").status, "VERIFIED");
  assert.equal(report.picklists.find((item) => item.fieldName === "Current Phase").status, "MANUAL_VERIFICATION_REQUIRED");
});

test("missing list/topic and draft or missing open journeys are reported without writes", () => {
  const environment = baseEnvironment();
  const report = buildPhase7b1DiscoveryReport({ environment, fields: completeFields(), journeys: [], lists: [], topics: [] });
  assert.equal(report.list.status, "MISSING");
  assert.equal(report.topic.status, "MISSING");
  assert.ok(report.journeys.every((item) => item.status === "NOT_OPEN_OR_MISSING"));
  assert.ok(report.journeys.every((item) => item.testCopy === "NOT_OPEN_OR_MISSING"));
});

test("mailing-list and topic parsers preserve identity and privacy evidence", () => {
  assert.deepEqual(parseMailingLists({ list_of_details: [{ listkey: "key", listname: "KZero Partner Onboarding", is_public: "false", owner: "Owner" }] }), [
    { isPublic: false, listKey: "key", listName: "KZero Partner Onboarding", owner: "Owner" }
  ]);
  assert.deepEqual(parseTopics({ topicDetails: [{ topicId: 42, topicName: "Partner Onboarding", primaryList: 7 }] }), [
    { primaryList: "7", topicId: "42", topicName: "Partner Onboarding" }
  ]);
});

test("production/test key collisions and unsafe recipients block readiness", () => {
  const collision = evaluatePhase7b1Configuration({
    ...baseEnvironment(), ZMA_TEST_J1_JOURNEY_KEY: "production-J1"
  });
  assert.ok(collision.blockers.includes("PRODUCTION_TEST_JOURNEY_KEY_COLLISION"));
  const recipient = evaluatePhase7b1Configuration({
    ...baseEnvironment(), ZOHO_TEST_EMAIL_ALLOWLIST: "unapproved@example.net"
  });
  assert.ok(recipient.blockers.includes("UNAPPROVED_TEST_RECIPIENT"));
});

test("unauthorized live calls and every write operation are refused", () => {
  const unauthorized = evaluatePhase7b1Configuration({
    ...baseEnvironment(), ZOHO_PHASE7B1_READ_ONLY_AUTHORIZATION: ""
  });
  assert.ok(unauthorized.blockers.includes("READ_ONLY_CALL_NOT_AUTHORIZED"));
  assert.throws(() => assertPhase7b1ReadOnlyOperation("LISTSUBSCRIBE"), /refuses non-read-only/);
  assert.throws(() => assertPhase7b1ReadOnlyOperation("TRIGGER_JOURNEY"), /refuses non-read-only/);
});

test("the Phase 7B.1 runner contains no contact or journey write invocation", async () => {
  const source = await readFile(new URL("../scripts/zoho-phase-7b1-readonly.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.subscribeLead\s*\(/);
  assert.doesNotMatch(source, /\.triggerJourney\s*\(/);
  assert.match(source, /getAllLeadFields/);
  assert.match(source, /getMailingLists/);
  assert.match(source, /getTopics/);
  assert.match(source, /getOpenJourneys/);
});
