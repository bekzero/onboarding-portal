import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolvePortalTaskDeepLink } from "../lib/portal-deep-link.ts";
import {
  classifyZohoEventDisposition,
  didActiveTaskChange,
  isApprovedJ8Transition,
  isQualifyingKzeroHandoff,
  shouldFinishNudge
} from "../lib/zoho-lifecycle-rules.ts";

function transition(completedOwner = "kzero_se", nextOwner = "msp") {
  return {
    completedTask: { owner: completedOwner, status: "complete", templateKey: "kzero-review" },
    nextTask: { owner: nextOwner, status: "waiting_on_msp", templateKey: "partner-action" },
    previousNextTask: { owner: completedOwner, status: "waiting_on_kzero", templateKey: "kzero-review" }
  };
}

test("J5 requires a genuine KZero-to-partner or shared handoff", () => {
  assert.equal(isQualifyingKzeroHandoff(transition("kzero_se", "msp")), true);
  assert.equal(isQualifyingKzeroHandoff(transition("kzero_se", "shared")), true);
  assert.equal(isQualifyingKzeroHandoff(transition("kzero_se", "kzero_se")), false);
  assert.equal(isQualifyingKzeroHandoff(transition("msp", "msp")), false);
  const noChange = transition();
  noChange.nextTask.templateKey = noChange.previousNextTask.templateKey;
  assert.equal(isQualifyingKzeroHandoff(noChange), false);
});

test("J8 is restricted to the stable NFR milestone", () => {
  const milestone = transition("msp", "msp");
  milestone.completedTask.templateKey = "complete-first-customer-rollout";
  assert.equal(isApprovedJ8Transition("nfr", milestone), true);
  assert.equal(isApprovedJ8Transition("customer", milestone), false);
  milestone.completedTask.templateKey = "another-task";
  assert.equal(isApprovedJ8Transition("nfr", milestone), false);
});

test("next-task timestamps and nudge completion use stable task identity", () => {
  assert.equal(didActiveTaskChange(transition().previousNextTask, transition().nextTask), true);
  assert.equal(shouldFinishNudge("partner-action", "partner-action", "msp"), true);
  assert.equal(shouldFinishNudge("partner-action", "different-task", "msp"), false);
  assert.equal(shouldFinishNudge("partner-action", undefined, "kzero_se"), true);
});

test("communication conflicts and subscription gaps remain held", () => {
  const base = {
    activePlanId: "plan-a",
    contextState: "ACTIVE",
    journey: false,
    planId: "plan-a",
    subscriptionStatus: "UNKNOWN"
  };
  assert.deepEqual(classifyZohoEventDisposition(base), { status: "PENDING" });
  assert.equal(
    classifyZohoEventDisposition({ ...base, activePlanId: "plan-b" }).holdReason,
    "COMMUNICATION_CONTEXT_CONFLICT"
  );
  assert.equal(
    classifyZohoEventDisposition({ ...base, contextState: null }).holdReason,
    "COMMUNICATION_CONTEXT_REQUIRED"
  );
  assert.equal(
    classifyZohoEventDisposition({ ...base, journey: true }).holdReason,
    "SUBSCRIPTION_NOT_VERIFIED"
  );
  assert.equal(
    classifyZohoEventDisposition({
      ...base,
      journey: true,
      marketingApprovalRequired: true,
      subscriptionStatus: "CONFIRMED"
    }).holdReason,
    "MARKETING_APPROVAL_REQUIRED"
  );
});

test("deep links resolve real NFR/customer tasks and ignore unsafe unknown keys", () => {
  const tasks = [
    { phaseId: "phase-1", templateKey: "book-kickoff" },
    { phaseId: "phase-5", templateKey: "complete-first-customer-rollout" }
  ];
  assert.deepEqual(
    resolvePortalTaskDeepLink(
      new URLSearchParams("tab=tasks&task=complete-first-customer-rollout"),
      tasks
    ),
    tasks[1]
  );
  assert.equal(resolvePortalTaskDeepLink(new URLSearchParams("tab=tasks&task=unknown"), tasks), null);
  assert.equal(resolvePortalTaskDeepLink(new URLSearchParams("tab=status&task=book-kickoff"), tasks), null);
});

test("lifecycle integrations remain transactional and contain no Zoho network calls", async () => {
  const persistence = await readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8");
  const documents = await readFile(new URL("../lib/onboarding-documents.ts", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../lib/zoho-lifecycle-events.ts", import.meta.url), "utf8");
  assert.match(persistence, /prisma\.\$transaction\(async \(transaction\)/);
  assert.match(documents, /recordZohoContactSyncEventsInTransaction\(transaction/);
  assert.match(lifecycle, /isZohoEventEmissionEnabled\(\)/);
  assert.doesNotMatch(lifecycle, /fetch\(|listsubscribe|action\/trigger/);
});

test("test fixture cannot run in production and never activates legacy plans", async () => {
  const fixture = await readFile(new URL("../lib/zoho-test-fixture.ts", import.meta.url), "utf8");
  const route = await readFile(
    new URL("../app/api/admin/zoho/test-fixture/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(fixture, /process\.env\.NODE_ENV !== "production"/);
  assert.match(fixture, /automationOrigin !== "NATIVE"/);
  assert.match(fixture, /ZOHO_TEST_DATABASE_CONFIRMED/);
  assert.match(route, /getAdminApiAuthError\(/);
});
