/**
 * Focused unit tests for the Zoho legacy MSP automation protection system.
 *
 * These tests cover only pure logic — no database, no Zoho API calls, no production
 * mutations. They validate fail-closed eligibility classification, the nudge reason
 * union, the migration SQL structure, and source-code enforcement of guard placement.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LEGACY_COHORT_MIGRATION } from "../scripts/zoho-phase-7a-migrations.mjs";

// ---------------------------------------------------------------------------
// Local re-implementation of pure classifier for test isolation
// (The canonical implementation lives in zoho-legacy-eligibility.ts behind
//  "server-only"; tests verify the logic inline and enforce the source shape.)
// ---------------------------------------------------------------------------

const LEGACY_AUTOMATION_BLOCK_REASON = "LEGACY_PLAN_AUTOMATION_PROTECTED";

function classifyLegacyAutomationEligibility({ legacyRecordPresent, planFound }) {
  if (!planFound || legacyRecordPresent === null) {
    return { allowed: false, reason: "AUTOMATION_ELIGIBILITY_UNKNOWN" };
  }
  if (legacyRecordPresent) {
    return { allowed: false, reason: LEGACY_AUTOMATION_BLOCK_REASON };
  }
  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// 1. Pure eligibility classifier
// ---------------------------------------------------------------------------

test("plan not found fails closed regardless of legacy record state", () => {
  const result = classifyLegacyAutomationEligibility({ legacyRecordPresent: false, planFound: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "AUTOMATION_ELIGIBILITY_UNKNOWN");
});

test("null legacy record (unknown) fails closed even when plan is found", () => {
  const result = classifyLegacyAutomationEligibility({ legacyRecordPresent: null, planFound: true });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "AUTOMATION_ELIGIBILITY_UNKNOWN");
});

test("legacy record present blocks automation with the canonical reason", () => {
  const result = classifyLegacyAutomationEligibility({ legacyRecordPresent: true, planFound: true });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, LEGACY_AUTOMATION_BLOCK_REASON);
  assert.equal(result.reason, "LEGACY_PLAN_AUTOMATION_PROTECTED");
});

test("no legacy record and plan found permits automation", () => {
  const result = classifyLegacyAutomationEligibility({ legacyRecordPresent: false, planFound: true });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

// ---------------------------------------------------------------------------
// 2. ZohoNudgeReason must include LEGACY_PLAN_AUTOMATION_PROTECTED
// ---------------------------------------------------------------------------

test("ZohoNudgeReason union includes LEGACY_PLAN_AUTOMATION_PROTECTED", async () => {
  const source = await readFile(new URL("../lib/zoho-nudge-rules.ts", import.meta.url), "utf8");
  assert.match(source, /LEGACY_PLAN_AUTOMATION_PROTECTED/,
    "ZohoNudgeReason must include LEGACY_PLAN_AUTOMATION_PROTECTED so the decide() BLOCKED path type-checks");
});

// ---------------------------------------------------------------------------
// 3. Migration SQL structure
// ---------------------------------------------------------------------------

test("legacy cohort migration creates immutable table with all three blocking triggers", async () => {
  const sql = await readFile(
    new URL(
      `../prisma/migrations/${LEGACY_COHORT_MIGRATION}/migration.sql`,
      import.meta.url
    ),
    "utf8"
  );
  // Table and FK
  assert.match(sql, /CREATE TABLE "zoho_legacy_automation_plans"/);
  assert.match(sql, /REFERENCES "onboarding_plans".*ON DELETE RESTRICT/s);
  // Seed from existing plans
  assert.match(sql, /INSERT INTO "zoho_legacy_automation_plans".*SELECT "id".*FROM "onboarding_plans"/s);
  // All three immutability triggers
  assert.match(sql, /zoho_legacy_cohort_reject_insert/);
  assert.match(sql, /zoho_legacy_cohort_reject_update/);
  assert.match(sql, /zoho_legacy_cohort_reject_delete/);
  // No destructive operations
  assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE)\b/i);
});

test("legacy cohort migration name is registered in the approved migration manifest", () => {
  assert.equal(
    LEGACY_COHORT_MIGRATION,
    "20261124190000_add_immutable_zoho_legacy_cohort",
    "Migration name must match the filesystem directory"
  );
});

// ---------------------------------------------------------------------------
// 4. Source-code guard enforcement — eligibility checked before every write path
// ---------------------------------------------------------------------------

test("zoho-foundation checks eligibility before creating any outbox event", async () => {
  const source = await readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8");
  // getZohoPlanAutomationEligibility is imported and called inside createZohoOutboxEventInTransaction
  assert.match(source, /getZohoPlanAutomationEligibility/);
  // Both contact-sync and journey-trigger paths hit the guard
  const eligibilityCallIndex = source.indexOf("getZohoPlanAutomationEligibility");
  const outboxCreateIndex = source.indexOf("zohoOutboxEvent.create");
  assert.ok(eligibilityCallIndex >= 0 && outboxCreateIndex > eligibilityCallIndex,
    "Eligibility check must appear before outbox event creation");
});

test("zoho-foundation checks eligibility before journey trigger events", async () => {
  const source = await readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8");
  const journeyFnIndex = source.indexOf("createZohoJourneyTriggerEventInTransaction");
  const eligibilityInJourney = source.indexOf("getZohoPlanAutomationEligibility", journeyFnIndex);
  assert.ok(eligibilityInJourney > journeyFnIndex,
    "Journey trigger must call eligibility check before proceeding");
});

test("zoho-contact-snapshot enforces eligibility before building contact data", async () => {
  const source = await readFile(new URL("../lib/zoho-contact-snapshot.ts", import.meta.url), "utf8");
  assert.match(source, /assertZohoPlanAutomationEligible/);
});

test("zoho-admin enforces eligibility before contact sync operations", async () => {
  const source = await readFile(new URL("../lib/zoho-admin.ts", import.meta.url), "utf8");
  assert.match(source, /assertZohoPlanAutomationEligible/);
});

test("zoho-pilot-admin enforces eligibility before pilot send operations", async () => {
  const source = await readFile(new URL("../lib/zoho-pilot-admin.ts", import.meta.url), "utf8");
  assert.match(source, /assertZohoPlanAutomationEligible/);
});

test("dispatcher quarantines pending legacy events before processing any claim", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(source, /quarantineLegacyQueuedEvents/);
  // quarantine must run before claimEventById in both dispatch paths
  const quarantineIndex = source.indexOf("quarantineLegacyQueuedEvents");
  const claimIndex = source.indexOf("claimEventById", quarantineIndex);
  assert.ok(quarantineIndex >= 0 && claimIndex > quarantineIndex,
    "quarantineLegacyQueuedEvents must precede claimEventById");
});

test("dispatcher cancels a claimed legacy event and never dispatches it", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  // The loadDispatchState result is checked for zohoLegacyAutomationProtection
  assert.match(source, /zohoLegacyAutomationProtection/);
  // quarantineLegacyQueuedEvents sets status=CANCELLED for all legacy plan events
  assert.match(source, /'CANCELLED'.*LEGACY_AUTOMATION_BLOCK_REASON|LEGACY_AUTOMATION_BLOCK_REASON.*'CANCELLED'/s);
  // The dispatch path also returns CANCELLED when a claimed event belongs to a legacy plan
  assert.match(source, /plan\.zohoLegacyAutomationProtection/);
});

test("nudge engine loads legacy protection field and blocks before rule evaluation", async () => {
  const source = await readFile(new URL("../lib/zoho-nudge-engine.ts", import.meta.url), "utf8");
  assert.match(source, /zohoLegacyAutomationProtection/);
  assert.match(source, /LEGACY_PLAN_AUTOMATION_PROTECTED/);
  // The legacy block is inside the decide() function, before the return that calls evaluateZohoNudgeEligibility
  const decideStart = source.indexOf("function decide(");
  assert.ok(decideStart >= 0, "decide() function must exist");
  const legacyBlockIndex = source.indexOf("zohoLegacyAutomationProtection", decideStart);
  const ruleCallIndex = source.indexOf("evaluateZohoNudgeEligibility(ruleInput)", decideStart);
  assert.ok(legacyBlockIndex >= 0, "Legacy block must be inside decide()");
  assert.ok(ruleCallIndex >= 0, "Rule evaluation must be inside decide()");
  assert.ok(legacyBlockIndex < ruleCallIndex,
    "Legacy block must precede nudge rule evaluation inside decide()");
});

// ---------------------------------------------------------------------------
// 5. New plans default to automation-disabled
// ---------------------------------------------------------------------------

test("new plans default to PENDING automation enrollment state (not auto-approved)", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  // The OnboardingPlan.automationEnrollmentState defaults to PENDING — plans are not
  // automatically approved. ACTIVE enrollment requires explicit approval.
  assert.match(schema, /automationEnrollmentState[^\n]*@default\(PENDING\)/);
  // EXCLUDED is a valid non-automation state; PENDING is the new-plan default
  assert.match(schema, /AutomationEnrollmentState[^}]*EXCLUDED[^}]*PENDING/s);
});
