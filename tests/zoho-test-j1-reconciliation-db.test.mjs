import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getPhase7aTarget } from "../scripts/zoho-phase-7a-safety.mjs";

const enabled = process.env.ZOHO_RECONCILIATION_DB_TEST === "1";

test("real PostgreSQL reconciliation is atomic, locked, idempotent, and rollback-safe", { skip: !enabled }, async () => {
  const target = getPhase7aTarget();
  const schema = `reconciliation_${Date.now()}_${process.pid}`;
  assert.match(schema, /^reconciliation_[0-9_]+$/);
  const withSchema = (connectionString) => {
    const url = new URL(connectionString);
    url.searchParams.set("schema", schema);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  };
  const runtimeUrl = withSchema(target.connectionString);
  const schemaPool = new Pool({ connectionString: target.directConnectionString, max: 1 });
  await schemaPool.query(`CREATE SCHEMA "${schema}"`);
  const migrationClient = await schemaPool.connect();
  try {
    await migrationClient.query(`SET search_path TO "${schema}"`);
    const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
    const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const migration of migrations) {
      const sql = await readFile(new URL(`${migration.name}/migration.sql`, migrationRoot), "utf8");
      await migrationClient.query(sql);
    }
  } catch (error) {
    migrationClient.release();
    await schemaPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await schemaPool.end();
    throw error;
  }
  migrationClient.release();
  process.env.DATABASE_URL = runtimeUrl;
  process.env.ZOHO_RECONCILIATION_TEST_SCHEMA = schema;
  Object.assign(process.env, {
    AUTH_URL: "https://onboarding-portal20.vercel.app",
    ZMA_FIELD_MAPPING_VERIFIED: "true",
    ZMA_LIST_KEY: "isolated-test-list-key",
    ZMA_PRIVATE_LIST_VERIFIED: "true",
    ZMA_TEST_J1_JOURNEY_KEY: "isolated-test-j1",
    ZMA_TEST_J1_TRIGGER_KEY: "isolated-test-trigger",
    ZMA_TOPIC_ID: "1329658000000062845",
    ZOHO_AUTOMATIC_DISPATCH_ENABLED: "false",
    ZOHO_CLIENT_ID: "isolated-client",
    ZOHO_CLIENT_SECRET: "isolated-secret",
    ZOHO_CONTACT_SYNC_ENABLED: "false",
    ZOHO_DISPATCH_ENABLED: "false",
    ZOHO_DISPATCH_MODE: "disabled",
    ZOHO_EVENT_EMISSION_ENABLED: "false",
    ZOHO_EXACT_EVENT_DISPATCH_ENABLED: "false",
    ZOHO_EXACT_EVENT_IDS: "",
    ZOHO_GLOBAL_KILL_SWITCH: "true",
    ZOHO_JOURNEY_TRIGGERING_ENABLED: "false",
    ZOHO_MSP_ENROLLMENT_CONTACT_SYNC_ENABLED: "false",
    ZOHO_PRODUCTION_DISPATCH_APPROVED: "false",
    ZOHO_REFRESH_TOKEN: "isolated-refresh",
    ZOHO_SINGLE_CONTACT_PILOT_ENABLED: "false",
    ZOHO_TEST_CONTACT_SYNC_ENABLED: "false",
    ZOHO_TEST_DATABASE_CONFIRMED: "false",
    ZOHO_TEST_EMAIL_ALLOWLIST: "b.eakin@kzero.com",
    ZOHO_TEST_FIXTURE_ENABLED: "false",
    ZOHO_TEST_J1_ENROLLMENT_ENABLED: "false",
    ZOHO_TEST_J1_RECONCILIATION_CONTACT_EVENT_ID: "reconciliation-original-contact",
    ZOHO_TEST_J1_RECONCILIATION_ENABLED: "true",
    ZOHO_TEST_J1_RECONCILIATION_J1_EVENT_ID: "reconciliation-original-j1",
    ZOHO_TEST_PLAN_IDS: "benmspe2etest-nfr",
    ZOHO_TEST_SYNC_ENABLED: "false",
    ZMA_NUDGE_EVALUATION_ENABLED: "false"
  });

  const pool = new Pool({ connectionString: runtimeUrl, max: 8 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  let appPrisma = null;
  const ids = {
    contact: "reconciliation-contact",
    conflict: "reconciliation-conflict",
    msp: "reconciliation-msp",
    originalContact: "reconciliation-original-contact",
    originalJ1: "reconciliation-original-j1",
    plan: "reconciliation-plan",
    task: "reconciliation-task"
  };
  const email = "b.eakin@kzero.com";
  const actor = "oidc:reconciliation-admin";

  async function cleanup() {
    await prisma.zohoAutomationAudit.deleteMany({ where: { onboardingPlanId: ids.plan } });
    await prisma.zohoOutboxEvent.deleteMany({ where: { onboardingPlanId: ids.plan } });
    await prisma.zohoJourneySend.deleteMany({ where: { onboardingPlanId: ids.plan } });
    await prisma.zohoCommunicationContext.deleteMany({ where: { recipientEmailNormalized: email } });
    await prisma.zohoRecipientSequence.deleteMany({ where: { recipientEmailNormalized: email } });
    await prisma.planContact.deleteMany({ where: { onboardingPlanId: ids.plan } });
    await prisma.onboardingTask.deleteMany({ where: { onboardingPlanId: ids.plan } });
    await prisma.onboardingPlan.deleteMany({ where: { id: ids.plan } });
    await prisma.msp.deleteMany({ where: { id: ids.msp } });
  }

  try {
    await cleanup();
    await prisma.msp.create({
      data: {
        accessMode: "temporary",
        assignedSalesEngineer: "Ben Eakin",
        id: ids.msp,
        name: "Reconciliation Test",
        primaryContactEmail: email,
        slug: "reconciliation-test",
        onboardingPlans: {
          create: {
            assignedSeBookingUrl: "https://example.test/book",
            assignedSeEmail: email,
            assignedSeName: "Ben Eakin",
            automaticJ1Allowed: true,
            automationEnrollmentState: "ACTIVE",
            automationOrigin: "NATIVE",
            automationTaskMappingState: "VERIFIED",
            currentStage: "Kickoff",
            id: ids.plan,
            lastActivityAt: new Date("2026-11-25T00:00:00.000Z"),
            nextTaskSince: new Date("2026-11-25T00:00:00.000Z"),
            planId: "benmspe2etest-nfr",
            status: "waiting_on_msp",
            tenantType: "nfr",
            onboardingTasks: {
              create: {
                description: "Schedule the kickoff meeting.",
                id: ids.task,
                order: 0,
                owner: "msp",
                status: "waiting_on_msp",
                templateKey: "book-kickoff",
                title: "Book Setup Call with Your KZero Sales Engineer"
              }
            },
            planContacts: {
              create: {
                automationEnabled: true,
                email,
                firstName: "Ben",
                id: ids.contact,
                lastName: "Eakin",
                normalizedEmail: email,
                role: "ONBOARDING_OWNER",
                subscriptionEvidenceReference: "isolated-consent-evidence",
                subscriptionStatus: "CONFIRMED",
                subscriptionVerificationSource: "isolated test",
                subscriptionVerifiedAt: new Date(),
                subscriptionVerifiedBy: actor
              }
            }
          }
        }
      }
    });
    await prisma.zohoCommunicationContext.create({
      data: { activePlanId: ids.plan, recipientEmailNormalized: email, state: "ACTIVE" }
    });
    await prisma.zohoRecipientSequence.create({
      data: { nextSequence: 3n, recipientEmailNormalized: email }
    });
    await prisma.zohoAutomationAudit.createMany({
      data: [
        { action: "msp_enrollment.contact_permission_recorded", actor, evidenceReference: "permission-evidence", onboardingPlanId: ids.plan, planId: "benmspe2etest-nfr", reason: "test", recipientEmailNormalized: email },
        { action: "msp_pilot.downstream_automation_review_passed", actor, evidenceReference: "downstream-evidence", onboardingPlanId: ids.plan, planId: "benmspe2etest-nfr", reason: "test", recipientEmailNormalized: email }
      ]
    });
    await prisma.zohoOutboxEvent.createMany({
      data: [
        {
          attemptCount: 1,
          eventKey: "reconciliation-original-contact-key",
          eventType: "UPSERT_CONTACT",
          id: ids.originalContact,
          lastProviderOutcome: "ACCEPTED_UNCONFIRMED",
          onboardingPlanId: ids.plan,
          payload: { event: { reason: "plan.created.test-j1" } },
          planId: "benmspe2etest-nfr",
          recipientEmailNormalized: email,
          sequence: 1n,
          status: "SUCCEEDED"
        },
        {
          eventKey: "reconciliation-original-j1-key",
          eventType: "TRIGGER_JOURNEY",
          holdReason: "SUBSCRIPTION_NOT_VERIFIED",
          id: ids.originalJ1,
          journey: "J1",
          onboardingPlanId: ids.plan,
          payload: { event: { reason: "plan.created.test-j1" } },
          planId: "benmspe2etest-nfr",
          recipientEmailNormalized: email,
          sequence: 2n,
          status: "HELD",
          taskKey: "book-kickoff"
        }
      ]
    });

    const { prepareTestJ1SnapshotReconciliation } = await import("../lib/zoho-test-j1-reconciliation.ts");
    appPrisma = (await import("../lib/prisma.ts")).prisma;
    const request = {
      actor,
      confirmation: "PREPARE ONE TEST J1 SNAPSHOT RECONCILIATION",
      planId: "benmspe2etest-nfr"
    };

    await prisma.zohoOutboxEvent.create({
      data: {
        eventKey: "reconciliation-sequence-conflict",
        eventType: "UPSERT_CONTACT",
        id: ids.conflict,
        onboardingPlanId: ids.plan,
        payload: {},
        planId: "benmspe2etest-nfr",
        recipientEmailNormalized: email,
        sequence: 3n,
        status: "CANCELLED"
      }
    });
    await assert.rejects(() => prepareTestJ1SnapshotReconciliation(request));
    assert.equal(await prisma.zohoAutomationAudit.count({ where: { action: "test_j1.snapshot_reconciliation_prepared", onboardingPlanId: ids.plan } }), 0);
    assert.equal((await prisma.zohoOutboxEvent.findUnique({ where: { id: ids.originalJ1 } })).status, "HELD");
    await prisma.zohoOutboxEvent.delete({ where: { id: ids.conflict } });

    const concurrent = await Promise.allSettled([
      prepareTestJ1SnapshotReconciliation(request),
      prepareTestJ1SnapshotReconciliation(request)
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length >= 1,
      true,
      concurrent.map((result) => result.status === "rejected" ? result.reason?.message : "fulfilled").join(" | ")
    );
    const reconciliationEvents = await prisma.zohoOutboxEvent.findMany({
      where: { onboardingPlanId: ids.plan, payload: { path: ["event", "reason"], equals: "plan.reconciled.test-j1" } },
      orderBy: { sequence: "asc" }
    });
    assert.equal(reconciliationEvents.length, 2);
    assert.equal(reconciliationEvents[0].eventType, "UPSERT_CONTACT");
    assert.equal(reconciliationEvents[1].eventType, "TRIGGER_JOURNEY");
    assert.equal(reconciliationEvents[0].payload.snapshot["SE Email"], email);
    assert.equal(reconciliationEvents[0].payload.snapshot["Last MSP Activity"], "2026-11-25T00:00:00.000Z");
    assert.deepEqual(reconciliationEvents[1].payload.snapshot, reconciliationEvents[0].payload.snapshot);
    assert.equal(reconciliationEvents[1].status, "HELD");
    assert.equal(reconciliationEvents[1].holdReason, "CONTACT_VALUES_NOT_VERIFIED");
    assert.equal(reconciliationEvents[1].payload.event.dependsOnContactEventId, reconciliationEvents[0].id);
    const originalJ1 = await prisma.zohoOutboxEvent.findUnique({ where: { id: ids.originalJ1 } });
    assert.equal(originalJ1.status, "CANCELLED");
    assert.equal(originalJ1.holdReason, `SUPERSEDED_BY_TEST_J1_RECONCILIATION:${reconciliationEvents[1].id}`);
    assert.equal(await prisma.zohoAutomationAudit.count({ where: { action: "test_j1.snapshot_reconciliation_prepared", onboardingPlanId: ids.plan } }), 1);
    const repeated = await prepareTestJ1SnapshotReconciliation(request);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.contactEvent.id, reconciliationEvents[0].id);
    assert.equal(repeated.journeyEvent.id, reconciliationEvents[1].id);
  } finally {
    await cleanup();
    if (appPrisma) await appPrisma.$disconnect();
    await prisma.$disconnect();
    await pool.end();
    await schemaPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await schemaPool.end();
  }
});
