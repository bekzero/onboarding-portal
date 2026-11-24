/**
 * zoho-legacy-journey-audit.mjs
 *
 * READ-ONLY diagnostic: enumerate legacy MSP plans from the local database and report
 * which Zoho journeys have outstanding/attempted sends for their contacts.
 *
 * Purpose: "Audit independently active Zoho journeys for legacy contacts; don't modify Zoho."
 *
 * This script:
 *   - Reads the zoho_legacy_automation_plans cohort (never modifies it)
 *   - Reads zoho_journey_sends for those plans
 *   - Reports journey activity per plan and contact without touching Zoho
 *   - Uses existing server-side DATABASE_URL credentials — no secrets are exposed
 *   - Performs zero mutations: no UPDATE, no INSERT, no DELETE, no Zoho API calls
 *
 * Usage:
 *   node --experimental-transform-types --env-file=.env.local \
 *     scripts/zoho-legacy-journey-audit.mjs [--json]
 *
 * Required env:
 *   DATABASE_URL  — read-only or read-write Postgres connection string
 *
 * Output: human-readable summary (or JSON with --json flag)
 * Exit 0 = audit completed cleanly
 * Exit 1 = configuration or database error
 */

import process from "node:process";
import { Pool } from "pg";

const outputJson = process.argv.includes("--json");

function log(message) {
  if (!outputJson) console.log(message);
}

function fail(message) {
  console.error(`[AUDIT ERROR] ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Credential check: confirm DATABASE_URL is present but never print it.
// ---------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail("DATABASE_URL is not set. Set it via --env-file or the environment.");
}

// Redact credentials from any display output.
function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.password = "***";
    parsed.username = parsed.username ? "***" : "";
    return parsed.toString();
  } catch {
    return "[unparseable URL]";
  }
}

log(`[AUDIT] Connecting to database: ${redactUrl(databaseUrl)}`);
log("[AUDIT] No Zoho API credentials are used. This scan reads only local database records.");

// ---------------------------------------------------------------------------
// Read-only database queries
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

async function readLegacyPlans(client) {
  const { rows } = await client.query(`
    SELECT
      lp."onboardingPlanId",
      lp."planId",
      lp."capturedAt",
      lp."captureMigration"
    FROM "zoho_legacy_automation_plans" lp
    ORDER BY lp."capturedAt" ASC, lp."planId" ASC
  `);
  return rows;
}

async function readJourneyActivity(client, onboardingPlanIds) {
  if (!onboardingPlanIds.length) return [];
  const placeholders = onboardingPlanIds.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(`
    SELECT
      js."onboardingPlanId",
      js."planId",
      js."journey",
      js."recipientEmailNormalized",
      js."taskKey",
      js."dedupeKey",
      js."handoffKey",
      js."attemptedAt",
      js."succeededAt",
      js."providerResult",
      js."createdAt"
    FROM "zoho_journey_sends" js
    WHERE js."onboardingPlanId" = ANY(ARRAY[${placeholders}]::text[])
    ORDER BY js."onboardingPlanId" ASC, js."createdAt" DESC
  `, onboardingPlanIds);
  return rows;
}

async function readQueuedEvents(client, onboardingPlanIds) {
  if (!onboardingPlanIds.length) return [];
  const placeholders = onboardingPlanIds.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(`
    SELECT
      e."onboardingPlanId",
      e."planId",
      e."eventKey",
      e."eventType",
      e."journey",
      e."recipientEmailNormalized",
      e."status",
      e."holdReason",
      e."attemptCount",
      e."nextAttemptAt",
      e."createdAt"
    FROM "zoho_outbox_events" e
    WHERE e."onboardingPlanId" = ANY(ARRAY[${placeholders}]::text[])
      AND e."status" IN ('PENDING', 'RETRY', 'HELD', 'PROCESSING')
    ORDER BY e."onboardingPlanId" ASC, e."createdAt" DESC
  `, onboardingPlanIds);
  return rows;
}

// ---------------------------------------------------------------------------
// Main audit
// ---------------------------------------------------------------------------

let client;
try {
  client = await pool.connect();

  const legacyPlans = await readLegacyPlans(client);
  const planIds = legacyPlans.map((r) => r.onboardingPlanId);
  const [journeySends, queuedEvents] = await Promise.all([
    readJourneyActivity(client, planIds),
    readQueuedEvents(client, planIds)
  ]);

  // Group by plan
  const journeysByPlan = new Map();
  for (const send of journeySends) {
    const existing = journeysByPlan.get(send.onboardingPlanId) ?? [];
    existing.push(send);
    journeysByPlan.set(send.onboardingPlanId, existing);
  }
  const queuedByPlan = new Map();
  for (const event of queuedEvents) {
    const existing = queuedByPlan.get(event.onboardingPlanId) ?? [];
    existing.push(event);
    queuedByPlan.set(event.onboardingPlanId, existing);
  }

  const report = {
    auditedAt: new Date().toISOString(),
    readOnly: true,
    zohoApiCallsMade: 0,
    mutationsMade: 0,
    summary: {
      totalLegacyPlans: legacyPlans.length,
      plansWithJourneySends: 0,
      plansWithActiveQueuedEvents: 0,
      totalJourneySends: journeySends.length,
      totalActiveQueuedEvents: queuedEvents.length
    },
    plans: []
  };

  for (const plan of legacyPlans) {
    const sends = journeysByPlan.get(plan.onboardingPlanId) ?? [];
    const queued = queuedByPlan.get(plan.onboardingPlanId) ?? [];

    if (sends.length) report.summary.plansWithJourneySends++;
    if (queued.length) report.summary.plansWithActiveQueuedEvents++;

    report.plans.push({
      onboardingPlanId: plan.onboardingPlanId,
      planId: plan.planId,
      capturedAt: plan.capturedAt,
      captureMigration: plan.captureMigration,
      journeySends: sends.map((s) => ({
        journey: s.journey,
        recipientEmailNormalized: s.recipientEmailNormalized,
        taskKey: s.taskKey,
        attemptedAt: s.attemptedAt,
        succeededAt: s.succeededAt,
        providerResult: s.providerResult,
        createdAt: s.createdAt
      })),
      activeQueuedEvents: queued.map((e) => ({
        eventKey: e.eventKey,
        eventType: e.eventType,
        journey: e.journey,
        recipientEmailNormalized: e.recipientEmailNormalized,
        status: e.status,
        holdReason: e.holdReason,
        attemptCount: e.attemptCount,
        nextAttemptAt: e.nextAttemptAt,
        createdAt: e.createdAt
      }))
    });
  }

  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n=== ZOHO LEGACY MSP JOURNEY AUDIT ===");
    console.log(`Audited at: ${report.auditedAt}`);
    console.log(`Legacy plans in cohort: ${report.summary.totalLegacyPlans}`);
    console.log(`Plans with journey send history: ${report.summary.plansWithJourneySends}`);
    console.log(`Plans with ACTIVE queued events (potential leak): ${report.summary.plansWithActiveQueuedEvents}`);
    console.log(`Total journey sends: ${report.summary.totalJourneySends}`);
    console.log(`Total active outbox events: ${report.summary.totalActiveQueuedEvents}`);
    console.log("");

    if (report.summary.plansWithActiveQueuedEvents > 0) {
      console.log("⚠️  WARNING: The following legacy plans have active queued events.");
      console.log("   Run the dispatcher (which calls quarantineLegacyQueuedEvents) to cancel them.");
      for (const plan of report.plans.filter((p) => p.activeQueuedEvents.length > 0)) {
        console.log(`\n  Plan: ${plan.planId} (${plan.onboardingPlanId})`);
        for (const event of plan.activeQueuedEvents) {
          console.log(`    - [${event.status}] ${event.eventType} ${event.journey ?? ""} -> ${event.recipientEmailNormalized} (${event.eventKey})`);
        }
      }
    } else {
      console.log("✅  No active queued events found for legacy plans.");
    }

    if (report.summary.plansWithJourneySends > 0) {
      console.log("\n📋 Journey send history for legacy plans (read-only, preserved):");
      for (const plan of report.plans.filter((p) => p.journeySends.length > 0)) {
        console.log(`\n  Plan: ${plan.planId}`);
        for (const send of plan.journeySends) {
          const status = send.succeededAt ? "SUCCEEDED" : send.attemptedAt ? "ATTEMPTED" : "PENDING";
          console.log(`    - [${status}] ${send.journey} -> ${send.recipientEmailNormalized} @ task=${send.taskKey ?? "n/a"}`);
        }
      }
    }
    console.log("\n[AUDIT COMPLETE] No mutations were made.\n");
  }

  process.exitCode = 0;
} catch (err) {
  fail(`Database query failed: ${err?.message ?? String(err)}`);
} finally {
  client?.release();
  await pool.end();
}
