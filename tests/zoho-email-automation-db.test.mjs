import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getPhase7aTarget } from "../scripts/zoho-phase-7a-safety.mjs";

const enabled = process.env.ZOHO_EMAIL_AUTOMATION_DB_TEST === "1";

test("real PostgreSQL enable/disable workflow is locked, atomic, idempotent, and contact-first", { skip: !enabled }, async () => {
  const target = getPhase7aTarget();
  const schema = `reconciliation_${Date.now()}_${process.pid}`;
  const withSchema = (connectionString) => {
    const url = new URL(connectionString);
    url.searchParams.set("schema", schema);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  };
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
      await migrationClient.query(await readFile(new URL(`${migration.name}/migration.sql`, migrationRoot), "utf8"));
    }
  } finally {
    migrationClient.release();
  }

  const runtimeUrl = withSchema(target.connectionString);
  Object.assign(process.env, {
    AUTH_URL: "https://onboarding.example.test",
    DATABASE_URL: runtimeUrl,
    ZMA_FIELD_MAPPING_VERIFIED: "true",
    ZMA_J1_JOURNEY_KEY: "isolated-j1-journey",
    ZMA_J1_TRIGGER_KEY: "isolated-j1-trigger",
    ZMA_LIST_KEY: "isolated-list",
    ZMA_PRIVATE_LIST_VERIFIED: "true",
    ZMA_TOPIC_ID: "1329658000000062845",
    ZOHO_CLIENT_ID: "isolated-client",
    ZOHO_CLIENT_SECRET: "isolated-secret",
    ZOHO_REFRESH_TOKEN: "isolated-refresh"
  });
  const pool = new Pool({ connectionString: runtimeUrl, max: 8 });
  const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const ids = { contact: "automation-contact", msp: "automation-msp", plan: "automation-plan", task: "automation-task" };
  const email = "automation.fixture@example.invalid";
  const planId = "automation-fixture-nfr";
  const actor = "oidc:automation-admin";
  const membershipCheck = async () => ({
    listStatuses: [], normalizedEmail: email, recommendedStatus: "UNKNOWN", requiresManualTopicAndMarketingVerification: true, truncated: false
  });

  async function allocate(tx) {
    const rows = await tx.$queryRaw`
      INSERT INTO "zoho_recipient_sequences" ("recipientEmailNormalized", "nextSequence", "createdAt", "updatedAt")
      VALUES (${email}, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("recipientEmailNormalized") DO UPDATE
      SET "nextSequence" = "zoho_recipient_sequences"."nextSequence" + 1, "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "nextSequence" - 1 AS "sequence"
    `;
    return rows[0].sequence;
  }

  async function enableFixture() {
    await membershipCheck();
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-email-automation:${ids.plan}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-context:${email}`}, 0))`;
      const plan = await tx.onboardingPlan.findUnique({ where: { id: ids.plan }, include: { planContacts: true } });
      const owner = plan.planContacts[0];
      if (plan.automationEnrollmentState === "ACTIVE" && owner.automationEnabled) return;
      await tx.zohoCommunicationContext.upsert({
        where: { recipientEmailNormalized: email },
        create: { activePlanId: ids.plan, recipientEmailNormalized: email, state: "ACTIVE" },
        update: { activePlanId: ids.plan, state: "ACTIVE", version: { increment: 1 } }
      });
      await tx.onboardingPlan.update({ where: { id: ids.plan }, data: { automaticJ1Allowed: true, automationEnrollmentState: "ACTIVE" } });
      await tx.planContact.update({ where: { id: ids.contact }, data: { automationEnabled: true } });
      const audit = await tx.zohoAutomationAudit.create({ data: { action: "email_automation.enabled", actor, onboardingPlanId: ids.plan, planId, reason: "isolated test", recipientEmailNormalized: email } });
      await tx.zohoOutboxEvent.create({ data: {
        eventKey: `contact:${audit.id}`, eventType: "UPSERT_CONTACT", onboardingPlanId: ids.plan, payload: { snapshot: "fixture" }, planId,
        recipientEmailNormalized: email, sequence: await allocate(tx), status: "PENDING"
      } });
      const send = await tx.zohoJourneySend.findUnique({ where: { dedupeKey: `journey:j1:book-kickoff:${planId}:${email}` } });
      if (!send) {
        await tx.zohoJourneySend.create({ data: { dedupeKey: `journey:j1:book-kickoff:${planId}:${email}`, journey: "J1", onboardingPlanId: ids.plan, planId, recipientEmailNormalized: email, taskKey: "book-kickoff" } });
        await tx.zohoOutboxEvent.create({ data: {
          eventKey: `journey:${audit.id}`, eventType: "TRIGGER_JOURNEY", journey: "J1", onboardingPlanId: ids.plan,
          payload: { event: { dependsOnContactEventId: `contact:${audit.id}` } }, planId, recipientEmailNormalized: email,
          sequence: await allocate(tx), status: "PENDING", taskKey: "book-kickoff"
        } });
      }
    });
  }

  async function disableFixture() {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-email-automation:${ids.plan}`}, 0))`;
      await tx.onboardingPlan.update({ where: { id: ids.plan }, data: { automaticJ1Allowed: false, automationEnrollmentState: "PAUSED" } });
      await tx.planContact.update({ where: { id: ids.contact }, data: { automationEnabled: false } });
      await tx.zohoOutboxEvent.updateMany({ where: { onboardingPlanId: ids.plan, status: { in: ["PENDING", "HELD", "RETRY"] } }, data: { status: "CANCELLED" } });
      await tx.zohoAutomationAudit.create({ data: { action: "email_automation.disabled", actor, onboardingPlanId: ids.plan, planId, reason: "isolated test", recipientEmailNormalized: email } });
    });
  }

  try {
    await client.msp.create({
      data: {
        accessMode: "temporary",
        assignedSalesEngineer: "Fixture SE",
        id: ids.msp,
        name: "Automation Fixture",
        primaryContactEmail: email,
        slug: "automation-fixture",
        onboardingPlans: { create: {
          assignedSeBookingUrl: "https://example.test/book",
          assignedSeEmail: "se@example.invalid",
          assignedSeName: "Fixture SE",
          automationEnrollmentState: "PENDING",
          automationOrigin: "NATIVE",
          automationTaskMappingState: "VERIFIED",
          currentStage: "Kickoff",
          id: ids.plan,
          planId,
          status: "in_progress",
          tenantType: "nfr",
          onboardingTasks: { create: {
            description: "Book kickoff.", id: ids.task, order: 0, owner: "msp", status: "waiting_on_msp", templateKey: "book-kickoff", title: "Book kickoff"
          } },
          planContacts: { create: {
            automationEnabled: false,
            email,
            firstName: "Automation",
            id: ids.contact,
            normalizedEmail: email,
            role: "ONBOARDING_OWNER",
            subscriptionEvidenceReference: "isolated subscription evidence",
            subscriptionStatus: "CONFIRMED",
            subscriptionVerifiedAt: new Date(),
            subscriptionVerifiedBy: actor,
            subscriptionVerificationSource: "isolated test"
          } }
        } }
      }
    });
    await client.zohoAutomationAudit.createMany({ data: [
      { action: "msp_enrollment.contact_permission_recorded", actor, evidenceReference: "isolated permission", onboardingPlanId: ids.plan, planId, reason: "test", recipientEmailNormalized: email },
      { action: "msp_pilot.downstream_automation_review_passed", actor, evidenceReference: "isolated list review", onboardingPlanId: ids.plan, planId, reason: "test", recipientEmailNormalized: email }
    ] });

    const concurrent = await Promise.all([
      enableFixture(),
      enableFixture()
    ]);
    assert.equal(concurrent.length, 2);
    const events = await client.zohoOutboxEvent.findMany({ where: { onboardingPlanId: ids.plan }, orderBy: { sequence: "asc" } });
    assert.equal(events.length, 2);
    assert.equal(events[0].eventType, "UPSERT_CONTACT");
    assert.equal(events[1].eventType, "TRIGGER_JOURNEY");
    assert.equal(events[1].journey, "J1");
    assert.ok(events[1].payload.event.dependsOnContactEventId);
    assert.equal(await client.zohoAutomationAudit.count({ where: { action: "email_automation.enabled", onboardingPlanId: ids.plan } }), 1);
    assert.equal((await client.onboardingPlan.findUnique({ where: { id: ids.plan } })).automationEnrollmentState, "ACTIVE");

    const firstCron = await pool.connect();
    const competingCron = await pool.connect();
    try {
      await firstCron.query("BEGIN");
      await competingCron.query("BEGIN");
      const claimSql = `
        SELECT event."id"
        FROM "zoho_outbox_events" event
        WHERE event."status" IN ('PENDING', 'RETRY')
          AND event."planId" = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM "zoho_outbox_events" earlier
            WHERE earlier."recipientEmailNormalized" = event."recipientEmailNormalized"
              AND earlier."sequence" < event."sequence"
              AND earlier."status" NOT IN ('SUCCEEDED', 'CANCELLED')
          )
        ORDER BY event."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const firstClaim = await firstCron.query(claimSql, [[planId]]);
      const competingClaim = await competingCron.query(claimSql, [[planId]]);
      assert.equal(firstClaim.rows.length, 1);
      assert.equal(firstClaim.rows[0].id, events[0].id);
      assert.equal(competingClaim.rows.length, 0);
    } finally {
      await firstCron.query("ROLLBACK");
      await competingCron.query("ROLLBACK");
      firstCron.release();
      competingCron.release();
    }

    await disableFixture();
    assert.equal(await client.zohoOutboxEvent.count({ where: { onboardingPlanId: ids.plan, status: "CANCELLED" } }), 2);
    assert.equal((await client.onboardingPlan.findUnique({ where: { id: ids.plan } })).automationEnrollmentState, "PAUSED");
    assert.equal((await client.planContact.findUnique({ where: { id: ids.contact } })).automationEnabled, false);

    await enableFixture();
    assert.equal(await client.zohoOutboxEvent.count({ where: { onboardingPlanId: ids.plan, eventType: "UPSERT_CONTACT" } }), 2);
    assert.equal(await client.zohoOutboxEvent.count({ where: { onboardingPlanId: ids.plan, eventType: "TRIGGER_JOURNEY" } }), 1);
    assert.equal(await client.zohoAutomationAudit.count({ where: { action: "email_automation.enabled", onboardingPlanId: ids.plan } }), 2);
  } finally {
    await client.$disconnect();
    await pool.end();
    await schemaPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await schemaPool.end();
  }
});
