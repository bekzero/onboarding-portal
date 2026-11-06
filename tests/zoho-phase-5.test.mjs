import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addBusinessDaysPreservingWallClock,
  calculateBusinessDayEligibility,
  getZonedBusinessDate,
  isTorontoDailyNudgeWindow
} from "../lib/zoho-business-days.ts";
import { evaluateZohoNudgeEligibility, ZOHO_NUDGE_THRESHOLDS } from "../lib/zoho-nudge-rules.ts";

const evaluationAt = new Date("2026-11-09T14:00:00.000Z"); // 09:00 Toronto

function base(overrides = {}) {
  return {
    automationEnrollmentState: "ACTIVE",
    automationOrigin: "NATIVE",
    automationTaskMappingState: "VERIFIED",
    competingActivePlanCount: 0,
    contextActivePlanId: "db-plan",
    contextState: "ACTIVE",
    currentStage: "Tenant Setup",
    currentTask: { owner: "msp", status: "waiting_on_msp", templateKey: "add-admins" },
    evaluationAt,
    hasPriorJ3: false,
    nextTaskSince: new Date("2026-11-02T14:00:00.000Z"),
    nudgeStartedAt: null,
    nudgeStatus: "NONE",
    onboardingPlanId: "db-plan",
    owner: { automationEnabled: true, normalizedEmail: "test@kzero.com", subscriptionStatus: "CONFIRMED" },
    planStatus: "in_progress",
    priorJ3Attempted: false,
    priorJ3Result: null,
    ...overrides
  };
}

test("A-D: marketing thresholds qualify the four supported post-kickoff phases", () => {
  assert.deepEqual(ZOHO_NUDGE_THRESHOLDS, {
    "Tenant Setup": 4,
    "App Review": 4,
    "SSO Rollout": 4,
    "First Customer Pilot": 7
  });
  for (const phase of ["Tenant Setup", "App Review", "SSO Rollout"]) {
    assert.equal(evaluateZohoNudgeEligibility(base({ currentStage: phase })).reason, "ELIGIBLE");
  }
  assert.equal(evaluateZohoNudgeEligibility(base({
    currentStage: "First Customer Pilot",
    nextTaskSince: new Date("2026-10-29T13:00:00.000Z")
  })).reason, "ELIGIBLE");
});

test("E: Kickoff never enters J3", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ currentStage: "Kickoff" })).reason, "KICKOFF_HANDLED_BY_J1");
});

test("F-H: MSP and Shared qualify while KZero ownership does not", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ currentTask: { owner: "msp", status: "in_progress", templateKey: "task" } })).reason, "ELIGIBLE");
  assert.equal(evaluateZohoNudgeEligibility(base({ currentTask: { owner: "shared", status: "waiting_on_msp", templateKey: "task" } })).reason, "ELIGIBLE");
  assert.equal(evaluateZohoNudgeEligibility(base({ currentTask: { owner: "kzero_se", status: "waiting_on_kzero", templateKey: "task" } })).reason, "WAITING_ON_KZERO");
});

test("I-K: paused, completed, and non-enrolled legacy plans are excluded", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ automationEnrollmentState: "PAUSED" })).reason, "PLAN_PAUSED");
  assert.equal(evaluateZohoNudgeEligibility(base({ automationEnrollmentState: "COMPLETE" })).reason, "PLAN_COMPLETE");
  assert.equal(evaluateZohoNudgeEligibility(base({ automationOrigin: "LEGACY", automationEnrollmentState: "EXCLUDED" })).reason, "AUTOMATION_EXCLUDED");
});

test("explicitly enrolled legacy plans can qualify from a truthful approved timestamp", () => {
  const decision = evaluateZohoNudgeEligibility(base({
    automationOrigin: "LEGACY",
    automationEnrollmentState: "ACTIVE",
    nextTaskSince: new Date("2026-11-02T14:00:00.000Z")
  }));
  assert.equal(decision.reason, "ELIGIBLE");
  assert.equal(evaluateZohoNudgeEligibility(base({
    automationOrigin: "LEGACY",
    automationEnrollmentState: "ACTIVE",
    nextTaskSince: null
  })).reason, "MISSING_TASK_TIMESTAMP");
});

test("L: a missing authoritative nextTaskSince is blocked", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ nextTaskSince: null })).reason, "MISSING_TASK_TIMESTAMP");
});

test("M-N: prior and unknown J3 state prevent another sequence", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ hasPriorJ3: true })).reason, "ALREADY_NUDGED");
  assert.equal(evaluateZohoNudgeEligibility(base({ hasPriorJ3: true, priorJ3Attempted: true, priorJ3Result: "UNKNOWN" })).reason, "UNCERTAIN_SEQUENCE");
  assert.equal(evaluateZohoNudgeEligibility(base({
    nudgeStatus: "WAITING",
    nudgeStartedAt: new Date("2026-10-20T13:00:00.000Z"),
    priorJ3Result: "UNKNOWN"
  })).reason, "UNCERTAIN_SEQUENCE");
  assert.equal(evaluateZohoNudgeEligibility(base({
    nudgeStatus: "WAITING",
    nudgeStartedAt: new Date("2026-10-20T13:00:00.000Z"),
    priorJ3Attempted: true,
    priorJ3Result: "TRIGGERED"
  })).reason, "STALE_SEQUENCE_REVIEW_REQUIRED");
  assert.equal(evaluateZohoNudgeEligibility(base({
    nudgeStatus: "WAITING",
    nudgeStartedAt: new Date("2026-10-20T13:00:00.000Z"),
    priorJ3Attempted: true,
    priorJ3Result: "FAILED"
  })).reason, "FAILED_SEQUENCE_REVIEW_REQUIRED");
});

test("O-P: multi-plan conflicts and unverified subscriptions block J3", () => {
  assert.equal(evaluateZohoNudgeEligibility(base({ competingActivePlanCount: 1 })).reason, "MULTIPLE_ACTIVE_PLANS");
  assert.equal(evaluateZohoNudgeEligibility(base({ owner: { automationEnabled: true, normalizedEmail: "test@kzero.com", subscriptionStatus: "MANUAL_REVIEW" } })).reason, "SUBSCRIPTION_UNVERIFIED");
  assert.equal(evaluateZohoNudgeEligibility(base({ contextActivePlanId: "other-plan" })).reason, "CONTEXT_CONFLICT");
});

test("below-threshold work remains not eligible until the wall-clock boundary", () => {
  const decision = evaluateZohoNudgeEligibility(base({
    evaluationAt: new Date("2026-11-06T13:59:59.000Z"),
    nextTaskSince: new Date("2026-11-02T14:00:00.000Z")
  }));
  assert.equal(decision.reason, "BELOW_THRESHOLD");
  assert.equal(decision.nextEligibleAt.toISOString(), "2026-11-06T14:00:00.000Z");
});

test("V: Friday advances to Monday without counting the weekend", () => {
  const monday = addBusinessDaysPreservingWallClock(new Date("2026-03-06T15:00:00.000Z"), 1);
  assert.equal(monday.toISOString(), "2026-03-09T14:00:00.000Z");
});

test("W: daylight-saving changes preserve Toronto local wall-clock time", () => {
  const result = calculateBusinessDayEligibility({
    start: new Date("2026-03-06T15:00:00.000Z"),
    thresholdBusinessDays: 1,
    evaluationAt: new Date("2026-03-09T14:00:00.000Z")
  });
  assert.equal(result.eligible, true);
  assert.equal(result.nextEligibleAt.toISOString(), "2026-03-09T14:00:00.000Z");
  assert.equal(
    addBusinessDaysPreservingWallClock(new Date("2026-10-30T14:00:00.000Z"), 1).toISOString(),
    "2026-11-02T15:00:00.000Z"
  );
});

test("X: month, year, and leap-year boundaries use calendar dates", () => {
  assert.equal(addBusinessDaysPreservingWallClock(new Date("2026-12-31T15:00:00.000Z"), 1).toISOString(), "2027-01-01T15:00:00.000Z");
  assert.equal(addBusinessDaysPreservingWallClock(new Date("2024-02-28T15:00:00.000Z"), 1).toISOString(), "2024-02-29T15:00:00.000Z");
});

test("Toronto scheduler accepts both DST-safe candidate UTC hours and rejects weekends", () => {
  assert.equal(isTorontoDailyNudgeWindow(new Date("2026-07-06T13:05:00.000Z")), true);
  assert.equal(isTorontoDailyNudgeWindow(new Date("2026-01-05T14:05:00.000Z")), true);
  assert.equal(isTorontoDailyNudgeWindow(new Date("2026-07-06T14:05:00.000Z")), false);
  assert.equal(isTorontoDailyNudgeWindow(new Date("2026-07-04T13:05:00.000Z")), false);
  assert.equal(getZonedBusinessDate(new Date("2026-01-01T03:00:00.000Z")), "2025-12-31");
});

test("Q-Y: schema and engine make daily runs and per-task preparation idempotent", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/zoho-nudge-engine.ts", import.meta.url), "utf8");
  assert.match(schema, /businessDate\s+String\s+@unique/);
  assert.match(schema, /@@unique\(\[runId, onboardingPlanId\]\)/);
  assert.match(engine, /pg_advisory_xact_lock/);
  assert.match(engine, /j3-eligible/);
  assert.match(engine, /recordZohoJourneyEventsInTransaction/);
  assert.match(engine, /nudgeStatus: "WAITING"/);
});

test("R-T: stale J3 is cancelled and completion/rollback emit urgent stop state", async () => {
  const dispatcherRules = await readFile(new URL("../lib/zoho-dispatch-rules.ts", import.meta.url), "utf8");
  const persistence = await readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8");
  assert.match(dispatcherRules, /J3_TASK_NO_LONGER_ACTIONABLE/);
  assert.match(persistence, /nudgeStatus: finishNudge \? "DONE"/);
  assert.match(persistence, /isStopState: finishNudge \|\| metrics\.status === "complete"/);
  assert.match(persistence, /isStopState: rollbackStopsNudge/);
});

test("U: Phase 4 retains failed or held stop-state events as critical state", async () => {
  const dispatcher = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(dispatcher, /CRITICAL_STOP_STATE_RECIPIENT_SUPPRESSED/);
  assert.doesNotMatch(dispatcher, /deleteMany\([\s\S]*isStopState/);
});

test("dry-run route is admin-only and cannot invoke the write evaluator or provider", async () => {
  const route = await readFile(new URL("../app/api/admin/zoho/nudges/preview/route.ts", import.meta.url), "utf8");
  const engine = await readFile(new URL("../lib/zoho-nudge-engine.ts", import.meta.url), "utf8");
  assert.match(route, /getAdminApiAuthError\(\)/);
  assert.match(route, /previewZohoNudges/);
  assert.doesNotMatch(route, /runDailyZohoNudgeEvaluation|recordZoho|dispatchZoho/);
  assert.doesNotMatch(engine, /getZohoApiClient|zohoDispatchProvider|fetch\(/);
});

test("cron endpoint requires bearer authorization and no schedule is activated", async () => {
  const route = await readFile(new URL("../app/api/cron/zoho-nudges/route.ts", import.meta.url), "utf8");
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /authorization/);
  assert.match(route, /runDailyZohoNudgeEvaluation/);
  await assert.rejects(readFile(new URL("../vercel.json", import.meta.url), "utf8"), /ENOENT/);
});

test("Z: all Phase 5 and external execution flags remain disabled by default", async () => {
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(env, /ZMA_NUDGE_EVALUATION_ENABLED=false/);
  assert.match(env, /ZOHO_GLOBAL_KILL_SWITCH=true/);
  assert.match(env, /ZOHO_JOURNEY_TRIGGERING_ENABLED=false/);
  assert.match(env, /ZOHO_AUTOMATIC_DISPATCH_ENABLED=false/);
  assert.match(env, /ZOHO_DISPATCH_MODE=disabled/);
});

test("empty eligibility sets are valid and create no implicit journey intent", () => {
  const decisions = [
    evaluateZohoNudgeEligibility(base({ currentStage: "Kickoff" })),
    evaluateZohoNudgeEligibility(base({ automationEnrollmentState: "PAUSED" }))
  ];
  assert.equal(decisions.filter((decision) => decision.status === "ELIGIBLE").length, 0);
});
