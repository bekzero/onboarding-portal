import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { evaluateFullFieldTestIntentReadiness } from "../lib/zoho-existing-plan-test-intent-core.ts";
import { evaluateExactEventMaintenancePosture } from "../lib/zoho-exact-event-dispatch-core.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {};" };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

process.env.ZOHO_PRODUCTION_ROLLOUT_PLAN_IDS ||= "benmsp-nfr";
const { createZohoContactSyncEventInTransaction } = await import("../lib/zoho-foundation.ts");

function ready(overrides = {}) {
  return {
    automaticDispatchEnabled: false,
    contactAutomationEnabled: true,
    contactSyncEnabled: false,
    contextOwnedByPlan: true,
    dispatchMode: "disabled",
    downstreamAutomationVerified: true,
    eventEmissionEnabled: false,
    globalKillSwitch: true,
    journeyTriggeringEnabled: false,
    listPrivacyVerified: true,
    membershipComplete: true,
    membershipStatuses: [],
    nudgeEvaluationEnabled: false,
    permissionEvidenceRecorded: true,
    pilotTargetMatches: true,
    planAutomationActive: true,
    productionDispatchApproved: false,
    singleContactPilotEnabled: false,
    subscriptionEvidenceRecorded: true,
    subscriptionStatus: "UNKNOWN",
    syncOnEnrollmentEnabled: false,
    testContactSyncEnabled: false,
    testModeEnabled: false,
    ...overrides
  };
}

test("exact eligible pilot state can prepare an intent while every sending path stays disabled", () => {
  assert.deepEqual(evaluateFullFieldTestIntentReadiness(ready()), { allowed: true, blockers: [] });
});

test("wrong targeting, missing evidence, and plan or context failures block preparation", () => {
  for (const [override, blocker] of [
    [{ pilotTargetMatches: false }, "PILOT_TARGET_MISMATCH"],
    [{ planAutomationActive: false }, "PLAN_OR_CONTACT_NOT_APPROVED"],
    [{ contactAutomationEnabled: false }, "PLAN_OR_CONTACT_NOT_APPROVED"],
    [{ contextOwnedByPlan: false }, "COMMUNICATION_CONTEXT_NOT_OWNED"],
    [{ permissionEvidenceRecorded: false }, "PERMISSION_EVIDENCE_MISSING"],
    [{ subscriptionEvidenceRecorded: false }, "SUBSCRIPTION_NOT_ELIGIBLE"],
    [{ downstreamAutomationVerified: false }, "DOWNSTREAM_AUTOMATION_UNVERIFIED"],
    [{ listPrivacyVerified: false }, "LIST_PRIVACY_UNVERIFIED"]
  ]) {
    assert.ok(evaluateFullFieldTestIntentReadiness(ready(override)).blockers.includes(blocker));
  }
});

test("incomplete and suppressed membership scans fail closed", () => {
  assert.ok(evaluateFullFieldTestIntentReadiness(ready({ membershipComplete: false })).blockers.includes("MEMBERSHIP_SCAN_INCOMPLETE"));
  for (const status of ["unsub", "bounce"]) {
    assert.ok(evaluateFullFieldTestIntentReadiness(ready({ membershipStatuses: [status] })).blockers.includes("RECIPIENT_SUPPRESSED"));
  }
  assert.equal(evaluateFullFieldTestIntentReadiness(ready({ membershipStatuses: ["active"] })).allowed, true);
});

test("preparation requires the kill switch and rejects every executable automation path", () => {
  assert.ok(evaluateFullFieldTestIntentReadiness(ready({ globalKillSwitch: false })).blockers.includes("GLOBAL_KILL_SWITCH_REQUIRED"));
  for (const override of [
    { automaticDispatchEnabled: true },
    { contactSyncEnabled: true },
    { dispatchMode: "test" },
    { eventEmissionEnabled: true },
    { journeyTriggeringEnabled: true },
    { nudgeEvaluationEnabled: true },
    { productionDispatchApproved: true },
    { singleContactPilotEnabled: true },
    { syncOnEnrollmentEnabled: true },
    { testContactSyncEnabled: true },
    { testModeEnabled: true }
  ]) assert.ok(evaluateFullFieldTestIntentReadiness(ready(override)).blockers.includes("AUTOMATION_PATH_ENABLED"));
});

function exactPosture(overrides = {}) {
  return {
    allowlistMatchesTarget: true,
    automaticDispatchEnabled: false,
    contactSyncEnabled: true,
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
    topicIdValid: true,
    ...overrides
  };
}

test("exact-event maintenance requires its dedicated gate and exact allowlists", () => {
  assert.deepEqual(evaluateExactEventMaintenancePosture(exactPosture()), { allowed: true, blockers: [] });
  assert.ok(evaluateExactEventMaintenancePosture(exactPosture({ exactEventDispatchEnabled: false })).blockers.includes("EXACT_EVENT_DISPATCH_DISABLED"));
  assert.ok(evaluateExactEventMaintenancePosture(exactPosture({ allowlistMatchesTarget: false })).blockers.includes("EXACT_TARGET_ALLOWLIST_MISMATCH"));
  assert.ok(evaluateExactEventMaintenancePosture(exactPosture({ globalKillSwitch: true })).blockers.includes("GLOBAL_KILL_SWITCH_ENABLED"));
});

test("exact-event maintenance rejects every unrelated provider-write path", () => {
  for (const override of [
    { automaticDispatchEnabled: true },
    { eventEmissionEnabled: true },
    { journeyTriggeringEnabled: true },
    { legacyTestSyncEnabled: true },
    { mspEnrollmentContactSyncEnabled: true },
    { nudgeEvaluationEnabled: true },
    { productionApproved: true },
    { singleContactPilotEnabled: true },
    { testContactSyncEnabled: true }
  ]) {
    assert.ok(evaluateExactEventMaintenancePosture(exactPosture(override)).blockers.includes("UNRELATED_WRITE_PATH_ENABLED"));
  }
});

test("route and service enforce Staff ADMIN, exact server targeting, durable idempotency, audit, and no dispatch", async () => {
  const [route, service, foundation, throttle, dispatchRoute, dispatcher, legacyTest, testContact, pilot] = await Promise.all([
    readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/full-field-test-intent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-existing-plan-test-intent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-foundation.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-throttle.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/zoho/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-phase2.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-test-contact.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/zoho-single-contact-pilot.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /getSensitiveAdminAuditActor/);
  assert.match(service, /loadConfiguredPilotPlan/);
  assert.match(service, /checkZohoListMembership/);
  assert.match(service, /getPersistedZohoContactSnapshotWithClient/);
  assert.match(service, /createZohoContactSyncEventInTransaction/);
  assert.match(service, /createZohoAutomationAuditInTransaction/);
  assert.match(service, /existing-plan-full-field-test/);
  assert.match(foundation, /transaction\.\$executeRaw\(Prisma\.sql`[\s\S]*pg_advisory_xact_lock/);
  assert.doesNotMatch(foundation, /transaction\.\$queryRaw\(Prisma\.sql`[\s\S]*pg_advisory_xact_lock/);
  assert.match(throttle, /transaction\.\$executeRaw\(Prisma\.sql`SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(throttle, /transaction\.\$queryRaw\(Prisma\.sql`SELECT pg_advisory_xact_lock/);
  assert.match(foundation, /findUnique\([\s\S]*eventKey/);
  assert.doesNotMatch(service, /subscribeLead|addLeadsInBulk|triggerJourney|dispatchZohoOutboxBatch/);
  assert.doesNotMatch(service, /TRIGGER_JOURNEY|ZohoJourneySend/);
  assert.match(dispatchRoute, /DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT/);
  assert.match(dispatchRoute, /approvedEvent\.id !== body\.eventId/);
  assert.match(dispatchRoute, /evaluateExactEventMaintenancePosture/);
  assert.match(dispatchRoute, /Generic batch dispatch is unavailable during exact-event maintenance/);
  assert.match(dispatcher, /event\."id" = \$\{eventId\}/);
  assert.match(dispatcher, /dispatchExactZohoOutboxEvent/);
  assert.match(dispatcher, /config\.exactEventDispatchEnabled/);
  assert.match(dispatcher, /getFullFieldTestIntentKey\(target\.planId, target\.email\)/);
  assert.match(dispatcher, /claim\.event\.eventType === "UPSERT_CONTACT"/);
  assert.match(legacyTest, /Legacy test synchronization is unavailable during exact-event maintenance/);
  assert.match(testContact, /Test Contact Sync is unavailable during exact-event maintenance/);
  assert.match(pilot, /configuration\.exactEventDispatchEnabled/);
});

function createLockManager() {
  let locked = false;
  const waiters = [];
  return {
    async acquire() {
      if (locked) await new Promise((resolve) => waiters.push(resolve));
      locked = true;
      return () => {
        const next = waiters.shift();
        if (next) next();
        else locked = false;
      };
    }
  };
}

function createOutboxHarness() {
  const database = { audits: [], events: new Map(), nextSequence: 1, providerWrites: 0 };
  const lock = createLockManager();
  let failNextInsert = false;

  async function prepare() {
    let releaseLock;
    const executed = [];
    const transaction = {
      async $executeRaw(statement) {
        executed.push(statement);
        releaseLock = await lock.acquire();
        return 1;
      },
      async $queryRaw() {
        return [{ sequence: BigInt(database.nextSequence++) }];
      },
      onboardingPlan: {
        async findUnique() {
          return { automationEnrollmentState: "ACTIVE", planId: "benmsp-nfr" };
        }
      },
      zohoOutboxEvent: {
        async findUnique({ where }) {
          return database.events.get(where.eventKey) ?? null;
        },
        async create({ data }) {
          if (failNextInsert) {
            failNextInsert = false;
            throw new Error("simulated event insert failure");
          }
          const event = { ...data, attemptCount: 0, id: `event-${database.events.size + 1}` };
          database.events.set(data.eventKey, event);
          return event;
        }
      }
    };

    try {
      const result = await createZohoContactSyncEventInTransaction(transaction, {
        eventKey: "contact-sync:existing-plan-full-field-test:benmsp-nfr:b.eakin%40kzero.com",
        onboardingPlanId: "plan-database-id",
        payload: { schemaVersion: 3 },
        recipientEmail: "b.eakin@kzero.com",
        status: "PENDING"
      });
      if (result.created) database.audits.push({ eventId: result.event.id });
      return { executed, result };
    } finally {
      releaseLock?.();
    }
  }

  return {
    database,
    failNextInsert() { failNextInsert = true; },
    prepare
  };
}

test("transaction-scoped advisory lock allows exactly one idempotent UPSERT_CONTACT event", async () => {
  const harness = createOutboxHarness();
  const first = await harness.prepare();
  const repeated = await harness.prepare();

  assert.equal(first.result.created, true);
  assert.equal(repeated.result.created, false);
  assert.equal(first.result.event.id, repeated.result.event.id);
  assert.equal(harness.database.events.size, 1);
  assert.equal(harness.database.audits.length, 1);
  assert.equal(harness.database.providerWrites, 0);
  assert.equal(first.executed.length, 1);
  assert.match(first.executed[0].strings.join(""), /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.equal(first.executed[0].values[0], "zoho-event:contact-sync:existing-plan-full-field-test:benmsp-nfr:b.eakin%40kzero.com");
});

test("concurrent preparations serialize on the same lock and cannot create duplicates", async () => {
  const harness = createOutboxHarness();
  const results = await Promise.all([harness.prepare(), harness.prepare(), harness.prepare()]);

  assert.equal(results.filter(({ result }) => result.created).length, 1);
  assert.equal(new Set(results.map(({ result }) => result.event.id)).size, 1);
  assert.equal(harness.database.events.size, 1);
  assert.equal(harness.database.audits.length, 1);
  assert.equal(harness.database.providerWrites, 0);
});

test("event insertion failure leaves no partial event, audit, or provider write", async () => {
  const harness = createOutboxHarness();
  harness.failNextInsert();

  await assert.rejects(harness.prepare(), /simulated event insert failure/);
  assert.equal(harness.database.events.size, 0);
  assert.equal(harness.database.audits.length, 0);
  assert.equal(harness.database.providerWrites, 0);
});

test("existing-plan preparation remains available to support without appearing in normal Case Preview", async () => {
  const ui = await readFile(new URL("../components/zoho-integration-status.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/zoho/automation/plans/[planId]/full-field-test-intent/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /Prepare Full-Field Intent/);
  assert.match(ui, /Open Support Diagnostics/);
  assert.match(route, /getSensitiveAdminApiAuthError/);
  assert.match(route, /prepareExistingFullFieldTestIntent/);
});
