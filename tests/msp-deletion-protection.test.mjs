import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MSP_HAS_AUTOMATION_HISTORY_CODE,
  MspHasAutomationHistoryError,
  hasProtectedMspZohoHistory
} from "../lib/msp-deletion-protection.ts";

const emptyCounts = {
  zohoAutomationAudits: 0,
  zohoCommunicationContexts: 0,
  zohoJourneySends: 0,
  zohoNudgeDecisions: 0,
  zohoOutboxEvents: 0
};

test("each protected Zoho relation blocks MSP deletion", () => {
  assert.equal(hasProtectedMspZohoHistory([{ _count: emptyCounts }]), false);

  for (const relation of Object.keys(emptyCounts)) {
    assert.equal(
      hasProtectedMspZohoHistory([{ _count: { ...emptyCounts, [relation]: 1 } }]),
      true,
      `${relation} must prevent deletion`
    );
  }
});

test("the deletion conflict has a stable public code and safe explanation", () => {
  const error = new MspHasAutomationHistoryError();
  assert.equal(error.code, MSP_HAS_AUTOMATION_HISTORY_CODE);
  assert.equal(error.code, "MSP_HAS_AUTOMATION_HISTORY");
  assert.match(error.message, /protected Zoho automation history/i);
  assert.doesNotMatch(error.message, /constraint|database|prisma/i);
});

test("the DELETE route returns a structured 409 before the destructive operation", async () => {
  const persistence = await readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/msps/[mspId]/route.ts", import.meta.url), "utf8");

  const deleteFunction = persistence.slice(persistence.indexOf("export async function deleteMsp"), persistence.indexOf("export async function getPortalPlanBundle"));
  const preflightIndex = deleteFunction.indexOf("hasProtectedMspZohoHistory");
  const deleteIndex = deleteFunction.indexOf("transaction.msp.delete");
  assert.ok(preflightIndex >= 0 && deleteIndex > preflightIndex);
  assert.match(route, /instanceof MspHasAutomationHistoryError/);
  assert.match(route, /code: error\.code, error: error\.message/);
  assert.match(route, /status: 409/);
  assert.match(route, /getAdminApiAuthError\("ADMIN"\)/);
});

test("the dashboard explains the conflict without reporting server unavailability", async () => {
  const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");
  const handler = dashboard.slice(dashboard.indexOf("async function handleDeleteMsp"), dashboard.indexOf("async function handleCompleteKzeroStep"));

  assert.match(handler, /response\.status === 409/);
  assert.match(handler, /payload\?\.code === "MSP_HAS_AUTOMATION_HISTORY"/);
  assert.match(handler, /setDeleteErrorMessage/);
  const conflictBranch = handler.slice(handler.indexOf("response.status === 409"), handler.indexOf("if (!response.ok)"));
  assert.doesNotMatch(conflictBranch, /setServerUnavailableState/);
  assert.match(dashboard, /Deletion is not available for this MSP\./);
  assert.match(dashboard, /role="alert"/);
});
