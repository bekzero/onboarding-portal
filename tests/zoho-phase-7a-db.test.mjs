import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import { getPhase7aTarget } from "../scripts/zoho-phase-7a-safety.mjs";

const target = getPhase7aTarget();
const pool = new Pool({ connectionString: target.connectionString, max: 12 });
const suffix = randomUUID().replaceAll('-', '');
const ids = {
  mspA: `phase7a-msp-a-${suffix}`,
  mspB: `phase7a-msp-b-${suffix}`,
  planA: `phase7a-plan-a-${suffix}`,
  planB: `phase7a-plan-b-${suffix}`,
  planPublicA: `phase7a-a-${suffix}`,
  planPublicB: `phase7a-b-${suffix}`,
  taskA: `phase7a-task-a-${suffix}`
};
const email = `phase7a.${suffix}@example.invalid`;
const runMonth = String((Number.parseInt(suffix.slice(0, 2), 16) % 12) + 1).padStart(2, '0');
const runDay = String((Number.parseInt(suffix.slice(2, 4), 16) % 28) + 1).padStart(2, '0');
const runDate = `2099-${runMonth}-${runDay}`;

async function expectPgCode(operation, expectedCode) {
  await assert.rejects(operation, (error) => error?.code === expectedCode);
}

before(async () => {
  const foundationCounts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "plan_contacts") AS contacts,
      (SELECT COUNT(*)::int FROM "zoho_communication_contexts") AS contexts,
      (SELECT COUNT(*)::int FROM "zoho_outbox_events") AS events,
      (SELECT COUNT(*)::int FROM "zoho_journey_sends") AS journeys,
      (SELECT COUNT(*)::int FROM "zoho_automation_audits") AS audits,
      (SELECT COUNT(*)::int FROM "zoho_api_throttles") AS throttles,
      (SELECT COUNT(*)::int FROM "zoho_nudge_evaluation_runs") AS nudge_runs
  `);
  assert.deepEqual(foundationCounts.rows[0], {
    contacts: 0, contexts: 0, events: 0, journeys: 0, audits: 0, throttles: 0, nudge_runs: 0
  }, 'The database integration suite requires a fresh post-migration rehearsal database.');
  await pool.query(`
    INSERT INTO "msps" ("id", "name", "slug", "primaryContactEmail", "assignedSalesEngineer", "accessMode", "enrollmentDate", "createdAt", "updatedAt")
    VALUES
      ($1, 'Phase 7A Fixture A', $2, $3, 'Test SE', 'temporary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, 'Phase 7A Fixture B', $5, $3, 'Test SE', 'temporary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.mspA, `phase7a-a-${suffix}`, email, ids.mspB, `phase7a-b-${suffix}`]);
  await pool.query(`
    INSERT INTO "onboarding_plans" (
      "id", "mspId", "planId", "tenantType", "progress", "status", "automationOrigin",
      "automationEnrollmentState", "automationTaskMappingState", "automaticJ1Allowed", "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'nfr', 0, 'in_progress', 'NATIVE', 'ACTIVE', 'VERIFIED', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'customer', 0, 'in_progress', 'NATIVE', 'ACTIVE', 'VERIFIED', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.planA, ids.mspA, ids.planPublicA, ids.planB, ids.mspB, ids.planPublicB]);
  await pool.query(`
    INSERT INTO "onboarding_tasks" (
      "id", "onboardingPlanId", "title", "status", "owner", "order", "templateKey", "createdAt", "updatedAt"
    ) VALUES ($1, $2, 'Book Setup Call with Your KZero Sales Engineer', 'waiting_on_msp', 'msp', 0, 'book-kickoff', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.taskA, ids.planA]);
});

after(async () => {
  await pool.query('DELETE FROM "zoho_nudge_evaluation_decisions" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query(`DELETE FROM "zoho_nudge_evaluation_runs" WHERE "id" LIKE $1`, [`phase7a-${suffix}-%`]);
  await pool.query('DELETE FROM "zoho_automation_audits" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "zoho_journey_sends" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "zoho_outbox_events" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "zoho_communication_contexts" WHERE "recipientEmailNormalized" = $1', [email]);
  await pool.query('DELETE FROM "zoho_recipient_sequences" WHERE "recipientEmailNormalized" = $1', [email]);
  await pool.query('DELETE FROM "zoho_api_throttles" WHERE "operation" IN (\'CONTACT_SYNC\', \'JOURNEY_TRIGGER\')');
  await pool.query('DELETE FROM "plan_contacts" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "onboarding_tasks" WHERE "onboardingPlanId" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "onboarding_plans" WHERE "id" IN ($1, $2)', [ids.planA, ids.planB]);
  await pool.query('DELETE FROM "msps" WHERE "id" IN ($1, $2)', [ids.mspA, ids.mspB]);
  await pool.end();
});

test('all Phase 1A, Phase 4, and Phase 5 migrations are applied', async () => {
  const expected = [
    '20261104150000_add_zoho_phase_1a_foundation',
    '20261104210000_add_zoho_phase_4_dispatcher',
    '20261105120000_add_zoho_phase_5_nudge_engine'
  ];
  const result = await pool.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  const applied = new Set(result.rows.map((row) => row.migration_name));
  assert.deepEqual(expected.filter((name) => !applied.has(name)), []);
});

test('legacy protection and empty automation foundation invariants hold before fixtures emit events', async () => {
  const legacy = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM "onboarding_plans"
    WHERE "id" NOT IN ($1, $2)
      AND ("automationOrigin" <> 'LEGACY' OR "automationEnrollmentState" <> 'EXCLUDED' OR "automaticJ1Allowed" <> false)
  `, [ids.planA, ids.planB]);
  assert.equal(legacy.rows[0].count, 0);
  const timestamps = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM "onboarding_tasks" task
    JOIN "onboarding_plans" plan ON plan."id" = task."onboardingPlanId"
    WHERE plan."automationOrigin" = 'LEGACY'
      AND (task."statusChangedAt" IS NOT NULL OR task."completedAt" IS NOT NULL)
  `);
  assert.equal(timestamps.rows[0].count, 0);
  const events = await pool.query(`SELECT COUNT(*)::int AS count FROM "zoho_outbox_events" WHERE "onboardingPlanId" NOT IN ($1, $2)`, [ids.planA, ids.planB]);
  assert.equal(events.rows[0].count, 0);
});

test('PlanContact CRUD, normalization constraints, cross-plan reuse, uniqueness, and rollback work', async () => {
  const ownerA = `phase7a-owner-a-${suffix}`;
  const ownerB = `phase7a-owner-b-${suffix}`;
  await pool.query(`
    INSERT INTO "plan_contacts" ("id", "onboardingPlanId", "email", "normalizedEmail", "firstName", "role", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $3, 'Initial', 'ONBOARDING_OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ownerA, ids.planA, email]);
  await pool.query('UPDATE "plan_contacts" SET "firstName" = \'Updated\', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1', [ownerA]);
  assert.equal((await pool.query('SELECT "firstName" FROM "plan_contacts" WHERE "id" = $1', [ownerA])).rows[0].firstName, 'Updated');

  await pool.query(`
    INSERT INTO "plan_contacts" ("id", "onboardingPlanId", "email", "normalizedEmail", "role", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $3, 'ONBOARDING_OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ownerB, ids.planB, email]);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM "plan_contacts" WHERE "normalizedEmail" = $1', [email])).rows[0].count, 2);

  await expectPgCode(() => pool.query(`
    INSERT INTO "plan_contacts" ("id", "onboardingPlanId", "email", "normalizedEmail", "role", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $3, 'ONBOARDING_OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-duplicate-${suffix}`, ids.planA, email]), '23505');
  await expectPgCode(() => pool.query(`
    INSERT INTO "plan_contacts" ("id", "onboardingPlanId", "email", "normalizedEmail", "role", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'NOT-NORMALIZED', 'TECHNICAL_ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-invalid-${suffix}`, ids.planA, email]), '23514');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO "plan_contacts" ("id", "onboardingPlanId", "email", "normalizedEmail", "role", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $3, 'EXECUTIVE_SPONSOR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [`phase7a-rollback-${suffix}`, ids.planA, email]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM "plan_contacts" WHERE "id" = $1', [`phase7a-rollback-${suffix}`])).rows[0].count, 0);
  await pool.query('DELETE FROM "plan_contacts" WHERE "id" = $1', [ownerB]);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM "plan_contacts" WHERE "id" = $1', [ownerB])).rows[0].count, 0);
});

test('kickoff booking and audit persist without task progress mutation and cancellation remains auditable', async () => {
  const before = (await pool.query('SELECT "progress", "status" FROM "onboarding_plans" WHERE "id" = $1', [ids.planA])).rows[0];
  const bookedAt = new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE "onboarding_plans" SET "kickoffBookedAt" = $2, "kickoffBookedBy" = $3 WHERE "id" = $1', [ids.planA, bookedAt, 'phase7a:test-actor']);
    await client.query(`INSERT INTO "zoho_automation_audits" ("id", "actor", "action", "onboardingPlanId", "planId", "reason", "createdAt") VALUES ($1, $2, 'kickoff_booking.booked', $3, $4, 'Phase 7A fixture', CURRENT_TIMESTAMP)`, [`phase7a-audit-book-${suffix}`, 'phase7a:test-actor', ids.planA, ids.planPublicA]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const booked = (await pool.query('SELECT "progress", "status", "kickoffBookedAt", "kickoffBookedBy" FROM "onboarding_plans" WHERE "id" = $1', [ids.planA])).rows[0];
  assert.equal(booked.progress, before.progress);
  assert.equal(booked.status, before.status);
  assert.equal(booked.kickoffBookedBy, 'phase7a:test-actor');
  assert.ok(booked.kickoffBookedAt);
  assert.equal((await pool.query('SELECT "status" FROM "onboarding_tasks" WHERE "id" = $1', [ids.taskA])).rows[0].status, 'waiting_on_msp');

  await pool.query('UPDATE "onboarding_plans" SET "kickoffBookedAt" = NULL, "kickoffBookedBy" = NULL WHERE "id" = $1', [ids.planA]);
  await pool.query(`INSERT INTO "zoho_automation_audits" ("id", "actor", "action", "onboardingPlanId", "planId", "reason", "createdAt") VALUES ($1, $2, 'kickoff_booking.cancelled', $3, $4, 'Phase 7A cancellation fixture', CURRENT_TIMESTAMP)`, [`phase7a-audit-cancel-${suffix}`, 'phase7a:test-actor', ids.planA, ids.planPublicA]);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM "zoho_automation_audits" WHERE "onboardingPlanId" = $1 AND "action" LIKE \'kickoff_booking.%\'', [ids.planA])).rows[0].count, 2);
});

test('outbox uniqueness, atomic rollback, monotonic concurrent recipient sequencing, and durable holds work', async () => {
  const sequenceSql = `
    INSERT INTO "zoho_recipient_sequences" ("recipientEmailNormalized", "nextSequence", "createdAt", "updatedAt")
    VALUES ($1, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("recipientEmailNormalized") DO UPDATE SET "nextSequence" = "zoho_recipient_sequences"."nextSequence" + 1, "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextSequence" - 1 AS sequence
  `;
  const allocated = await Promise.all(Array.from({ length: 20 }, () => pool.query(sequenceSql, [email])));
  const sequences = allocated.map((result) => Number(result.rows[0].sequence)).sort((a, b) => a - b);
  assert.deepEqual(sequences, Array.from({ length: 20 }, (_, index) => index + 1));

  const eventKey = `phase7a:event:${suffix}`;
  await pool.query(`
    INSERT INTO "zoho_outbox_events" ("id", "eventKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "eventType", "payload", "sequence", "status", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, 'UPSERT_CONTACT', '{}'::jsonb, 1001, 'HELD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-event-${suffix}`, eventKey, ids.planA, ids.planPublicA, email]);
  await expectPgCode(() => pool.query(`
    INSERT INTO "zoho_outbox_events" ("id", "eventKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "eventType", "payload", "sequence", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, 'UPSERT_CONTACT', '{}'::jsonb, 1002, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-event-duplicate-${suffix}`, eventKey, ids.planA, ids.planPublicA, email]), '23505');

  const originalProgress = (await pool.query('SELECT "progress" FROM "onboarding_plans" WHERE "id" = $1', [ids.planA])).rows[0].progress;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE "onboarding_plans" SET "progress" = "progress" + 1 WHERE "id" = $1', [ids.planA]);
    await assert.rejects(client.query(`
      INSERT INTO "zoho_outbox_events" ("id", "eventKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "eventType", "payload", "sequence", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, 'UPSERT_CONTACT', '{}'::jsonb, 1003, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [`phase7a-event-rollback-${suffix}`, eventKey, ids.planA, ids.planPublicA, email]));
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  assert.equal((await pool.query('SELECT "progress" FROM "onboarding_plans" WHERE "id" = $1', [ids.planA])).rows[0].progress, originalProgress);
  const restartedPool = new Pool({ connectionString: target.connectionString, max: 12 });
  try {
    const held = await restartedPool.query('SELECT "status" FROM "zoho_outbox_events" WHERE "eventKey" = $1', [eventKey]);
    assert.equal(held.rows[0].status, 'HELD');
  } finally {
    await restartedPool.end();
  }
});

test('SKIP LOCKED claim selection, recipient lease fencing, recovery, throttle state, and retry state are durable', async () => {
  await pool.query(`
    INSERT INTO "zoho_communication_contexts" ("recipientEmailNormalized", "activePlanId", "state", "version", "createdAt", "updatedAt")
    VALUES ($1, $2, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("recipientEmailNormalized") DO UPDATE SET "activePlanId" = EXCLUDED."activePlanId", "state" = 'ACTIVE', "version" = 0, "processingClaimId" = NULL, "processingLeaseExpiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
  `, [email, ids.planA]);
  await pool.query('UPDATE "zoho_outbox_events" SET "status" = \'PENDING\', "holdReason" = NULL WHERE "eventKey" = $1', [`phase7a:event:${suffix}`]);
  const claimSql = `
    SELECT event."id" FROM "zoho_outbox_events" event
    WHERE event."status" IN ('PENDING', 'RETRY')
      AND event."recipientEmailNormalized" = $1
      AND NOT EXISTS (
        SELECT 1 FROM "zoho_outbox_events" earlier
        WHERE earlier."recipientEmailNormalized" = event."recipientEmailNormalized"
          AND earlier."sequence" < event."sequence"
          AND earlier."status" NOT IN ('SUCCEEDED', 'CANCELLED')
      )
    ORDER BY event."createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1
  `;
  const workerA = await pool.connect();
  const workerB = await pool.connect();
  try {
    await workerA.query('BEGIN');
    await workerB.query('BEGIN');
    const first = await workerA.query(claimSql, [email]);
    const second = await workerB.query(claimSql, [email]);
    assert.equal(first.rowCount, 1);
    assert.equal(second.rowCount, 0);
    await workerA.query('COMMIT');
    await workerB.query('COMMIT');
  } finally {
    workerA.release();
    workerB.release();
  }

  const leaseResults = await Promise.all(['claim-a', 'claim-b'].map((claimId) => pool.query(`
    UPDATE "zoho_communication_contexts"
    SET "processingClaimId" = $2, "processingClaimedAt" = CURRENT_TIMESTAMP,
        "processingLeaseExpiresAt" = CURRENT_TIMESTAMP + interval '2 minutes', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "recipientEmailNormalized" = $1 AND "version" = 0 AND "processingLeaseExpiresAt" IS NULL
  `, [email, claimId])));
  assert.equal(leaseResults.reduce((sum, result) => sum + result.rowCount, 0), 1);
  const lease = (await pool.query('SELECT "processingClaimId", "version" FROM "zoho_communication_contexts" WHERE "recipientEmailNormalized" = $1', [email])).rows[0];
  const staleFence = await pool.query('UPDATE "zoho_communication_contexts" SET "processingClaimId" = NULL WHERE "recipientEmailNormalized" = $1 AND "version" = 0', [email]);
  assert.equal(staleFence.rowCount, 0);
  await pool.query(`UPDATE "zoho_communication_contexts" SET "processingLeaseExpiresAt" = CURRENT_TIMESTAMP - interval '1 second' WHERE "recipientEmailNormalized" = $1`, [email]);
  const recovered = await pool.query(`
    UPDATE "zoho_communication_contexts" SET "processingClaimId" = NULL, "processingClaimedAt" = NULL, "processingLeaseExpiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "recipientEmailNormalized" = $1 AND "processingClaimId" = $2 AND "version" = $3 AND "processingLeaseExpiresAt" < CURRENT_TIMESTAMP
  `, [email, lease.processingClaimId, lease.version]);
  assert.equal(recovered.rowCount, 1);

  await Promise.all(Array.from({ length: 12 }, () => pool.query(`
    INSERT INTO "zoho_api_throttles" ("operation", "windowStartedAt", "requestCount", "createdAt", "updatedAt")
    VALUES ('CONTACT_SYNC', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("operation") DO UPDATE SET "requestCount" = "zoho_api_throttles"."requestCount" + 1, "updatedAt" = CURRENT_TIMESTAMP
  `)));
  assert.equal((await pool.query(`SELECT "requestCount" FROM "zoho_api_throttles" WHERE "operation" = 'CONTACT_SYNC'`)).rows[0].requestCount, 12);
  await pool.query(`UPDATE "zoho_outbox_events" SET "status" = 'RETRY', "nextAttemptAt" = CURRENT_TIMESTAMP + interval '5 minutes' WHERE "eventKey" = $1`, [`phase7a:event:${suffix}`]);
  const retry = (await pool.query('SELECT "status", "nextAttemptAt" FROM "zoho_outbox_events" WHERE "eventKey" = $1', [`phase7a:event:${suffix}`])).rows[0];
  assert.equal(retry.status, 'RETRY');
  assert.ok(retry.nextAttemptAt);
});

test('J3 deduplication, unknown outcomes, context conflicts, and urgent stop state persist durably', async () => {
  await pool.query(`
    INSERT INTO "zoho_communication_contexts" ("recipientEmailNormalized", "activePlanId", "state", "version", "createdAt", "updatedAt")
    VALUES ($1, $2, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("recipientEmailNormalized") DO UPDATE SET "activePlanId" = EXCLUDED."activePlanId", "state" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
  `, [email, ids.planA]);
  await expectPgCode(() => pool.query(`
    INSERT INTO "zoho_communication_contexts" ("recipientEmailNormalized", "activePlanId", "state", "createdAt", "updatedAt")
    VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [email, ids.planB]), '23505');

  await pool.query(`
    UPDATE "onboarding_plans"
    SET "nudgeTaskKey" = 'book-kickoff', "nudgeStartedAt" = CURRENT_TIMESTAMP, "nudgeStatus" = 'WAITING'
    WHERE "id" = $1
  `, [ids.planA]);
  const dedupeKey = `phase7a:j3:${suffix}`;
  await pool.query(`
    INSERT INTO "zoho_journey_sends" (
      "id", "dedupeKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "journey",
      "taskKey", "providerResult", "attemptedAt", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, 'J3_R1', 'book-kickoff', 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-j3-${suffix}`, dedupeKey, ids.planA, ids.planPublicA, email]);
  await expectPgCode(() => pool.query(`
    INSERT INTO "zoho_journey_sends" (
      "id", "dedupeKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "journey", "providerResult", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, 'J3_R1', 'UNKNOWN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-j3-duplicate-${suffix}`, dedupeKey, ids.planA, ids.planPublicA, email]), '23505');

  await pool.query(`
    UPDATE "onboarding_tasks" SET "status" = 'complete', "statusChangedAt" = CURRENT_TIMESTAMP, "completedAt" = CURRENT_TIMESTAMP
    WHERE "id" = $1
  `, [ids.taskA]);
  await pool.query(`UPDATE "onboarding_plans" SET "nudgeStatus" = 'DONE' WHERE "id" = $1`, [ids.planA]);
  await pool.query(`
    INSERT INTO "zoho_outbox_events" (
      "id", "eventKey", "onboardingPlanId", "planId", "recipientEmailNormalized", "eventType", "journey",
      "taskKey", "payload", "sequence", "isStopState", "status", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, 'UPSERT_CONTACT', 'J3_R1', 'book-kickoff',
      '{"nudgeStatus":"Done"}'::jsonb, 1101, true, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-stop-${suffix}`, `phase7a:stop:${suffix}`, ids.planA, ids.planPublicA, email]);

  const restartedPool = new Pool({ connectionString: target.connectionString, max: 2 });
  try {
    const state = await restartedPool.query(`
      SELECT plan."nudgeStatus", send."providerResult", event."isStopState", event."status"
      FROM "onboarding_plans" plan
      JOIN "zoho_journey_sends" send ON send."onboardingPlanId" = plan."id"
      JOIN "zoho_outbox_events" event ON event."onboardingPlanId" = plan."id" AND event."eventKey" = $2
      WHERE plan."id" = $1 AND send."dedupeKey" = $3
    `, [ids.planA, `phase7a:stop:${suffix}`, dedupeKey]);
    assert.deepEqual(state.rows[0], {
      nudgeStatus: 'DONE',
      providerResult: 'UNKNOWN',
      isStopState: true,
      status: 'PENDING'
    });
  } finally {
    await restartedPool.end();
  }
});

test('daily evaluation run and decision uniqueness prevent duplicate nudge preparation records', async () => {
  const runId = `phase7a-${suffix}-run`;
  await pool.query(`
    INSERT INTO "zoho_nudge_evaluation_runs" ("id", "businessDate", "timezone", "processingClaimId", "processingLeaseExpiresAt", "createdAt", "updatedAt")
    VALUES ($1, $2, 'America/Toronto', $3, CURRENT_TIMESTAMP + interval '10 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [runId, runDate, `phase7a-${suffix}-claim`]);
  await expectPgCode(() => pool.query(`
    INSERT INTO "zoho_nudge_evaluation_runs" ("id", "businessDate", "timezone", "processingClaimId", "processingLeaseExpiresAt", "createdAt", "updatedAt")
    VALUES ($1, $2, 'America/Toronto', $3, CURRENT_TIMESTAMP + interval '10 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-${suffix}-run-duplicate`, runDate, `phase7a-${suffix}-claim-2`]), '23505');
  await pool.query(`
    INSERT INTO "zoho_nudge_evaluation_decisions" ("id", "runId", "businessDate", "onboardingPlanId", "planId", "status", "reasonCode", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, 'BLOCKED', 'PHASE7A_FIXTURE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-${suffix}-decision`, runId, runDate, ids.planA, ids.planPublicA]);
  await expectPgCode(() => pool.query(`
    INSERT INTO "zoho_nudge_evaluation_decisions" ("id", "runId", "businessDate", "onboardingPlanId", "planId", "status", "reasonCode", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, 'BLOCKED', 'PHASE7A_DUPLICATE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`phase7a-${suffix}-decision-duplicate`, runId, runDate, ids.planA, ids.planPublicA]), '23505');
});
