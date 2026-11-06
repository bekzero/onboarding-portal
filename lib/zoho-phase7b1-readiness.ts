import type { ZohoJourney, ZohoLeadField, ZohoMailingList, ZohoTopic } from "./zoho-api-core";
import { buildZohoFieldDiscoveryReport, getZohoFieldIdentifierMap } from "./zoho-field-mapping.ts";

export const PHASE7B1_EXPECTED_ORGANIZATION = "org859403413";
export const PHASE7B1_READ_ONLY_AUTHORIZATION = "I_AUTHORIZE_PHASE7B1_READ_ONLY_ZOHO_CALLS";
export const PHASE7B1_REQUIRED_SCOPES = [
  "ZohoMarketingAutomation.lead.READ",
  "ZohoMarketingAutomation.lead.UPDATE",
  "ZohoMarketingAutomation.journey.READ"
] as const;

export const PHASE7B1_JOURNEYS = {
  J1: "ONB J1 Welcome and Kickoff Booking",
  J3_R1: "ONB J3-R1 Next Action Nudge",
  J5: "ONB J5 Your Next Step Is Ready",
  J8: "ONB J8 Completion and Expansion"
} as const;

export const PHASE7B1_PICKLISTS = {
  "Current Phase": ["Kickoff", "Tenant Setup", "App Review", "SSO Rollout", "First Customer Pilot", "Onboarding Complete"],
  "Next Task Owner": ["MSP", "KZero SE", "Shared"],
  "Next Task Status": ["Action Required", "In Progress", "KZero Working", "Upcoming", "Complete"],
  "Onboarding Role": ["Onboarding Owner", "Executive Sponsor", "Technical Admin"],
  "Onboarding State": ["Active", "Paused", "Complete"],
  "Tenant Type": ["NFR", "Customer"]
} as const;

const PHASE7B1_READ_ONLY_OPERATIONS = new Set([
  "GET_ALL_LEAD_FIELDS",
  "GET_MAILING_LISTS",
  "GET_OPEN_JOURNEYS",
  "GET_TOPICS"
]);

export function assertPhase7b1ReadOnlyOperation(operation: string) {
  if (!PHASE7B1_READ_ONLY_OPERATIONS.has(operation)) {
    throw new Error(`Phase 7B.1 refuses non-read-only operation: ${operation}.`);
  }
}

type Environment = Record<string, string | undefined>;

function value(environment: Environment, name: string) {
  return environment[name]?.trim() ?? "";
}

function enabled(environment: Environment, name: string) {
  return value(environment, name).toLowerCase() === "true";
}

function csv(environment: Environment, name: string) {
  return value(environment, name).split(",").map((item) => item.trim()).filter(Boolean);
}

function journeyConfig(environment: Environment, prefix: "" | "TEST_") {
  return {
    J1: { journeyKey: value(environment, `ZMA_${prefix}J1_JOURNEY_KEY`), triggerKey: value(environment, `ZMA_${prefix}J1_TRIGGER_KEY`) },
    J3_R1: { journeyKey: value(environment, `ZMA_${prefix}J3_JOURNEY_KEY`), triggerKey: value(environment, `ZMA_${prefix}J3_TRIGGER_KEY`) },
    J5: { journeyKey: value(environment, `ZMA_${prefix}J5_JOURNEY_KEY`), triggerKey: value(environment, `ZMA_${prefix}J5_TRIGGER_KEY`) },
    J8: { journeyKey: value(environment, `ZMA_${prefix}J8_JOURNEY_KEY`), triggerKey: value(environment, `ZMA_${prefix}J8_TRIGGER_KEY`) }
  };
}

function scopeSatisfied(configured: Set<string>, required: string) {
  if (configured.has(required)) return true;
  if (required === "ZohoMarketingAutomation.lead.UPDATE") {
    return configured.has("ZohoMarketingAutomation.lead.CREATE-UPDATE") ||
      configured.has("ZohoMarketingAutomation.lead.WRITE") || configured.has("ZohoMarketingAutomation.lead.ALL");
  }
  if (required === "ZohoMarketingAutomation.lead.READ") {
    return configured.has("ZohoMarketingAutomation.lead.ALL");
  }
  return false;
}

export function evaluatePhase7b1Configuration(environment: Environment) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const missingCredentials = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"]
    .filter((name) => !value(environment, name));
  if (missingCredentials.length) blockers.push("MISSING_OAUTH_CREDENTIALS");

  if (value(environment, "ZOHO_PHASE7B1_EXPECTED_ORGANIZATION") !== PHASE7B1_EXPECTED_ORGANIZATION) {
    blockers.push("WRONG_OR_UNCONFIRMED_ORGANIZATION");
  }
  if (!value(environment, "ZOHO_PHASE7B1_ORGANIZATION_VERIFICATION_REFERENCE")) {
    blockers.push("ORGANIZATION_EVIDENCE_REQUIRED");
  }
  if (value(environment, "ZOHO_PHASE7B1_READ_ONLY_AUTHORIZATION") !== PHASE7B1_READ_ONLY_AUTHORIZATION) {
    blockers.push("READ_ONLY_CALL_NOT_AUTHORIZED");
  }

  const scopes = new Set(csv(environment, "ZOHO_PHASE7B1_OAUTH_SCOPES"));
  const missingScopes = PHASE7B1_REQUIRED_SCOPES.filter((scope) => !scopeSatisfied(scopes, scope));
  if (missingScopes.length) blockers.push("MISSING_REQUIRED_OAUTH_SCOPES");
  if (scopes.has("ZohoMarketingAutomation.journey.CREATE")) {
    warnings.push("JOURNEY_CREATE_SCOPE_PRESENT_BUT_UNUSED");
  }

  if (!value(environment, "ZMA_LIST_KEY")) blockers.push("MISSING_LIST_KEY");
  if (!value(environment, "ZMA_TOPIC_ID")) blockers.push("MISSING_TOPIC_ID");
  if (!value(environment, "ZOHO_PHASE7B1_EXPECTED_LIST_OWNER")) warnings.push("EXPECTED_LIST_OWNER_NOT_CONFIGURED");

  const unsafeFlags = [
    ["ZOHO_EVENT_EMISSION_ENABLED", enabled(environment, "ZOHO_EVENT_EMISSION_ENABLED")],
    ["ZOHO_CONTACT_SYNC_ENABLED", enabled(environment, "ZOHO_CONTACT_SYNC_ENABLED")],
    ["ZOHO_JOURNEY_TRIGGERING_ENABLED", enabled(environment, "ZOHO_JOURNEY_TRIGGERING_ENABLED")],
    ["ZOHO_AUTOMATIC_DISPATCH_ENABLED", enabled(environment, "ZOHO_AUTOMATIC_DISPATCH_ENABLED")],
    ["ZOHO_PRODUCTION_DISPATCH_APPROVED", enabled(environment, "ZOHO_PRODUCTION_DISPATCH_APPROVED")],
    ["ZMA_NUDGE_EVALUATION_ENABLED", enabled(environment, "ZMA_NUDGE_EVALUATION_ENABLED")]
  ].filter(([, active]) => active).map(([name]) => name as string);
  if (value(environment, "ZOHO_GLOBAL_KILL_SWITCH").toLowerCase() !== "true") unsafeFlags.push("ZOHO_GLOBAL_KILL_SWITCH");
  if (!['', 'disabled'].includes(value(environment, "ZOHO_DISPATCH_MODE").toLowerCase())) unsafeFlags.push("ZOHO_DISPATCH_MODE");
  if (unsafeFlags.length) blockers.push("WRITE_OR_AUTOMATION_FLAG_ENABLED");

  const production = journeyConfig(environment, "");
  const tests = journeyConfig(environment, "TEST_");
  const keyCollisions = (Object.keys(production) as Array<keyof typeof production>).filter((journey) =>
    Boolean(production[journey].journeyKey) &&
    (production[journey].journeyKey === tests[journey].journeyKey ||
      production[journey].triggerKey === tests[journey].triggerKey)
  );
  if (keyCollisions.length) blockers.push("PRODUCTION_TEST_JOURNEY_KEY_COLLISION");

  const allowlistedEmails = csv(environment, "ZOHO_TEST_EMAIL_ALLOWLIST").map((email) => email.toLowerCase());
  const approvedEmails = new Set(csv(environment, "ZOHO_PHASE7B1_APPROVED_INTERNAL_EMAILS").map((email) => email.toLowerCase()));
  const unsafeEmails = allowlistedEmails.filter((email) => !/^\S+@\S+\.\S+$/.test(email) || !approvedEmails.has(email));
  if (unsafeEmails.length) blockers.push("UNAPPROVED_TEST_RECIPIENT");
  if (!allowlistedEmails.length) warnings.push("NO_TEST_RECIPIENT_CONFIGURED");

  return {
    blockers: [...new Set(blockers)],
    keyCollisions,
    missingCredentials,
    missingScopes,
    readyForLiveReadOnlyCalls: blockers.length === 0,
    unsafeFlags,
    unsafeRecipientCount: unsafeEmails.length,
    warnings
  };
}

function normalizedValues(values: readonly string[]) {
  return [...values].map((item) => item.trim().toLowerCase()).sort();
}

export function buildPhase7b1DiscoveryReport(input: {
  environment: Environment;
  fields: ZohoLeadField[];
  journeys: ZohoJourney[];
  lists: ZohoMailingList[];
  topics: ZohoTopic[];
}) {
  const fieldReport = buildZohoFieldDiscoveryReport(input.fields);
  const identifiers = getZohoFieldIdentifierMap(input.fields);
  const picklists = Object.entries(PHASE7B1_PICKLISTS).map(([fieldName, expected]) => {
    const field = fieldReport.find((item) => item.expectedField === fieldName);
    const actual = field?.allowedValues;
    return {
      actualValues: actual ?? null,
      expectedValues: expected,
      fieldName,
      status: !actual ? "MANUAL_VERIFICATION_REQUIRED" :
        JSON.stringify(normalizedValues(actual)) === JSON.stringify(normalizedValues(expected)) ? "VERIFIED" : "MISMATCH"
    };
  });

  const configuredListKey = value(input.environment, "ZMA_LIST_KEY");
  const list = input.lists.find((item) => item.listKey === configuredListKey);
  const expectedListName = "KZero Partner Onboarding";
  const expectedListOwner = value(input.environment, "ZOHO_PHASE7B1_EXPECTED_LIST_OWNER");
  const listStatus = !list ? "MISSING" : list.listName !== expectedListName ? "IDENTITY_MISMATCH" : "FOUND";

  const configuredTopicId = value(input.environment, "ZMA_TOPIC_ID");
  const topic = input.topics.find((item) => item.topicId === configuredTopicId);
  const topicStatus = !topic ? "MISSING" : topic.topicName !== "Partner Onboarding" ? "IDENTITY_MISMATCH" : "FOUND";

  const production = journeyConfig(input.environment, "");
  const tests = journeyConfig(input.environment, "TEST_");
  const journeys = (Object.keys(PHASE7B1_JOURNEYS) as Array<keyof typeof PHASE7B1_JOURNEYS>).map((journey) => {
    const expectedName = PHASE7B1_JOURNEYS[journey];
    const configured = production[journey];
    const found = input.journeys.find((item) => item.journeyKey === configured.journeyKey) ??
      input.journeys.find((item) => item.journeyName.trim().toLowerCase() === expectedName.toLowerCase());
    const testConfigured = tests[journey];
    const testFound = input.journeys.find((item) => item.journeyKey === testConfigured.journeyKey);
    return {
      journey,
      name: found?.journeyName ?? expectedName,
      status: !found ? "NOT_OPEN_OR_MISSING" :
        configured.journeyKey && configured.triggerKey &&
        found.journeyKey === configured.journeyKey && found.triggerKey === configured.triggerKey ? "CONFIGURED_OPEN_TRIGGER" : "FOUND_UNVERIFIED",
      testCopy: !testConfigured.journeyKey || !testConfigured.triggerKey ? "NOT_CONFIGURED" :
        !testFound ? "NOT_OPEN_OR_MISSING" : /test/i.test(testFound.journeyName) ? "CONFIGURED_OPEN_TRIGGER" : "NAME_NOT_DISTINGUISHABLE",
      triggerability: "CONTROLLED_TRIGGER_TEST_REQUIRED"
    };
  });

  return {
    fields: {
      identifierMappingReady: identifiers.ready,
      missingOrAmbiguous: identifiers.missing,
      report: fieldReport,
      schemaShapeReady: identifiers.ready && fieldReport.every((item) => item.mappingStatus === "FOUND"),
      typeMismatchCount: fieldReport.filter((item) => item.mappingStatus === "TYPE_MISMATCH").length
    },
    journeys,
    list: {
      isPrivate: list?.isPublic === false,
      ownerPresent: Boolean(list?.owner),
      ownershipStatus: !list?.owner || !expectedListOwner ? "MANUAL_VERIFICATION_REQUIRED" :
        list.owner.trim().toLowerCase() === expectedListOwner.toLowerCase() ? "VERIFIED" : "MISMATCH",
      status: listStatus
    },
    picklists,
    topic: {
      primaryList: topic?.primaryList ?? null,
      status: topicStatus,
      topicAssociationEligibility: "MANUAL_VERIFICATION_REQUIRED",
      doubleOptInBehavior: "CONTROLLED_SUBSCRIBE_TEST_REQUIRED"
    }
  };
}
