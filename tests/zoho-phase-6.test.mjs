import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateZohoNudgeEligibility } from "../lib/zoho-nudge-rules.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function legacy(overrides = {}) {
  return {
    automationEnrollmentState: "ACTIVE", automationOrigin: "LEGACY", automationTaskMappingState: "VERIFIED",
    competingActivePlanCount: 0, contextActivePlanId: "legacy-db-plan", contextState: "ACTIVE",
    currentStage: "Tenant Setup", currentTask: { owner: "msp", status: "waiting_on_msp", templateKey: "add-admins" },
    evaluationAt: new Date("2026-11-09T14:00:00.000Z"), hasPriorJ3: false,
    nextTaskSince: new Date("2026-11-02T14:00:00.000Z"), nudgeStartedAt: null, nudgeStatus: "NONE",
    onboardingPlanId: "legacy-db-plan", owner: { automationEnabled: true, normalizedEmail: "legacy@example.com", subscriptionStatus: "CONFIRMED" },
    planStatus: "in_progress", priorJ3Attempted: false, priorJ3Result: null, ...overrides
  };
}

test("manually enrolled legacy plans use enrollment state and truthful timestamps", () => {
  assert.equal(evaluateZohoNudgeEligibility(legacy()).reason, "ELIGIBLE");
  assert.equal(evaluateZohoNudgeEligibility(legacy({ automationEnrollmentState: "EXCLUDED" })).reason, "AUTOMATION_EXCLUDED");
  assert.equal(evaluateZohoNudgeEligibility(legacy({ nextTaskSince: null })).reason, "MISSING_TASK_TIMESTAMP");
});

test("admin center includes the five required responsive sections and monitoring language", async () => {
  const ui = await read("components/zoho-automation-center.tsx");
  for (const label of ["Overview", "Event History", "Reminders", "Contacts & Conflicts", "Configuration"]) assert.match(ui, new RegExp(label));
  assert.match(ui, /overflow-x-auto/);
  assert.match(ui, /External automation remains dormant/);
  assert.match(ui, /not proof that an email was delivered/i);
  assert.match(ui, /Viewing it does not send emails or change onboarding state/);
  assert.match(ui, /bg-surface|text-foreground/);
});

test("monitoring APIs require the existing server-side admin session", async () => {
  for (const path of [
    "app/api/admin/zoho/automation/overview/route.ts",
    "app/api/admin/zoho/automation/events/route.ts",
    "app/api/admin/zoho/automation/contacts/route.ts",
    "app/api/admin/zoho/automation/plans/[planId]/route.ts"
  ]) assert.match(await read(path), /getAdminApiAuthError/);
});

test("shared admin sessions are blocked from sensitive Zoho writes", async () => {
  const auth = await read("lib/admin-auth.ts");
  const actions = await read("app/api/admin/zoho/automation/actions/route.ts");
  const subscription = await read("app/api/admin/zoho/verify-subscription/route.ts");
  const reconciliation = await read("app/api/admin/zoho/dispatch/[eventId]/reconcile/route.ts");
  assert.match(auth, /INDIVIDUAL_ADMIN_IDENTITY_REQUIRED/);
  assert.match(actions, /getSensitiveAdminApiAuthError/);
  assert.match(subscription, /getSensitiveAdminApiAuthError/);
  assert.match(reconciliation, /getSensitiveAdminApiAuthError/);
  assert.doesNotMatch(actions, /getAdminAuditActor|request\.json/);
});

test("event and conflict services are bounded and omit immutable payload snapshots", async () => {
  const service = await read("lib/zoho-admin-center.ts");
  assert.match(service, /Math\.min\(maximum/);
  assert.match(service, /take: pageSize/);
  assert.match(service, /take: take \+ 1/);
  assert.doesNotMatch(service, /payload:\s*true/);
  assert.match(service, /authorization removed/);
  assert.match(service, /refresh_token\|access_token/);
});

test("event history supports filters, sorting, pagination and uncertain outcomes", async () => {
  const service = await read("lib/zoho-admin-center.ts");
  const ui = await read("components/zoho-automation-center.tsx");
  for (const field of ["recipient", "journey", "eventType", "status", "from", "to", "sort", "direction"]) assert.match(service, new RegExp(`get\\(\\"${field}\\"\\)`));
  assert.match(service, /providerResult: "UNKNOWN"/);
  assert.match(ui, /UNKNOWN/);
  assert.match(ui, /No automation events match these filters/);
});

test("stop-state and contact conflict monitoring do not claim success prematurely", async () => {
  const service = await read("lib/zoho-admin-center.ts");
  const ui = await read("components/zoho-automation-center.tsx");
  assert.match(service, /isStopState: true/);
  assert.match(service, /PENDING.*HELD.*PROCESSING.*RETRY.*DEAD/);
  assert.match(ui, /does not prove Zoho received the update/);
  assert.match(ui, /One normalized email may have only one active plan communication context/);
  assert.match(ui, /Confirm ZMA Clear and Release/);
  assert.match(ui, /disabled key=\{label\}/);
});

test("case preview links to filtered automation history", async () => {
  const component = await read("components/zoho-integration-status.tsx");
  const dashboard = await read("components/internal-dashboard.tsx");
  assert.match(component, /View Automation History/);
  assert.match(component, /automationEnrollmentState/);
  assert.match(component, /lastSuccessfulContactSync/);
  assert.match(dashboard, /Zoho Automation/);
  assert.match(dashboard, /href="\/admin\/zoho"/);
});

test("configuration is read-only and production flags remain dormant", async () => {
  const env = await read(".env.example");
  const ui = await read("components/zoho-automation-center.tsx");
  for (const line of [
    "ZMA_NUDGE_EVALUATION_ENABLED=false", "ZOHO_EVENT_EMISSION_ENABLED=false", "ZOHO_GLOBAL_KILL_SWITCH=true",
    "ZOHO_JOURNEY_TRIGGERING_ENABLED=false", "ZOHO_AUTOMATIC_DISPATCH_ENABLED=false",
    "ZOHO_PRODUCTION_DISPATCH_APPROVED=false", "ZOHO_DISPATCH_MODE=disabled"
  ]) assert.match(env, new RegExp(line));
  assert.match(ui, /cannot activate dispatch, journeys, nudges, or cron/);
});
