import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const zohoUi = await readFile(new URL("../components/zoho-integration-status.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");

test("Zoho Case Preview exposes four accessible, inert client-side sections", () => {
  for (const [id, label] of [
    ["overview", "Overview"],
    ["contact-sync", "Contact Sync"],
    ["journeys", "Journeys"],
    ["advanced", "Advanced"]
  ]) {
    assert.match(zohoUi, new RegExp(`id: "${id}", label: "${label}"`));
    assert.match(zohoUi, new RegExp(`id=\\{\`zoho-case-tab-\\$\\{section\\.id\\}\`\\}`));
    assert.match(zohoUi, new RegExp(`zoho-case-panel-${id}`));
  }
  assert.match(zohoUi, /role="tablist"/);
  assert.match(zohoUi, /role="tabpanel"/);
  assert.match(zohoUi, /ArrowLeft.*ArrowRight.*Home.*End/s);

  const navigation = zohoUi.slice(zohoUi.indexOf("zohoCaseSections.map"), zohoUi.indexOf("zoho-case-panel-overview"));
  assert.doesNotMatch(navigation, /fetch\(|post\(/);
  assert.match(navigation, /setActiveSection\(section\.id\)/);
});

test("mount remains read-only and section switching cannot create mutation requests", () => {
  const effect = zohoUi.slice(zohoUi.indexOf("useEffect(() =>"), zohoUi.indexOf("async function post"));
  assert.match(effect, /void loadDetails\(\)/);
  assert.doesNotMatch(effect, /method:\s*"POST"|post\(/);
  assert.match(zohoUi, /fetch\(`\/api\/admin\/zoho\/status\?planId=/);
  assert.match(zohoUi, /fetch\(`\/api\/admin\/zoho\/automation\/plans\/\$\{encodeURIComponent\(planId\)\}`/);
});

test("all existing Zoho actions retain their handlers, endpoints, and confirmations", () => {
  const expectedEndpoints = [
    "/api/admin/zoho/discover",
    "/api/admin/zoho/test-sync/preview",
    "/api/admin/zoho/test-sync",
    "/api/admin/zoho/subscription-check",
    "/readiness-controls",
    "/pilot/preview",
    "/pilot/execute",
    "/full-field-test-intent",
    "/api/admin/zoho/dispatch"
  ];
  for (const endpoint of expectedEndpoints) assert.ok(zohoUi.includes(endpoint), `Missing endpoint ${endpoint}`);

  for (const [label, handler] of [
    ["Preview Sync", "previewControlledPilot"],
    ["Run Single-Contact Pilot", "runControlledPilot"],
    ["Prepare Full-Field Intent", "prepareFullFieldTestIntent"],
    ["Dispatch Exact Test Event", "dispatchFullFieldTestIntent"],
    ["Run Read-only Discovery", "runDiscovery"],
    ["Preview Test Sync", "createPreview"],
    ["Check List Membership", "checkMembership"],
    ["Add Allowlisted Test Email", "performTestSync"]
  ]) {
    assert.match(zohoUi, new RegExp(`onClick=\\{\\(\\) => void ${handler}\\(\\)\\}`));
    assert.ok(zohoUi.includes(label));
  }

  assert.match(zohoUi, /PREPARE ONE FULL-FIELD ZOHO TEST INTENT/);
  assert.match(zohoUi, /DISPATCH ONE ALLOWLISTED FULL-FIELD TEST EVENT/);
  assert.match(zohoUi, /RUN SINGLE-CONTACT ZOHO PILOT/);
});

test("advanced write controls remain disabled by authoritative state", () => {
  assert.match(zohoUi, /!controlledPilot\?\.executionAuthorized/);
  assert.match(zohoUi, /!pilotPreview\?\.membership\?\.complete/);
  assert.match(zohoUi, /!planSummary\?\.administrativeControls\.canManage/);
  assert.match(zohoUi, /!exactDispatchWindow/);
  assert.match(zohoUi, /!\["PENDING", "RETRY"\]\.includes\(fullFieldTestIntent\.status\)/);
  assert.match(zohoUi, /status\.configuration\.exactEventDispatchEnabled/);
  assert.match(zohoUi, /exactDispatchBase && !status\?\.configuration\.journeyTriggeringEnabled/);
  assert.match(zohoUi, /exactDispatchBase && status\?\.configuration\.journeyTriggeringEnabled === true/);
  assert.match(zohoUi, /exactEventAllowlistedCount === 1/);
  assert.match(zohoUi, /!status\.configuration\.automaticDispatchEnabled/);
});

test("status presentation handles event states and long diagnostics without overstating verification", () => {
  assert.match(zohoUi, /humanize\(fullFieldTestIntent\.status\)/);
  assert.match(zohoUi, /lastProviderOutcome/);
  assert.match(zohoUi, /Provider acceptance is not independent field verification/);
  assert.match(zohoUi, /break-all.*fullFieldTestIntent\.id/);
  assert.match(zohoUi, /break-words.*role="alert"/);
  assert.match(zohoUi, /Important blockers/);
  assert.match(zohoUi, /Configured API connectivity does not mean a journey is active/);
});

test("journey cards preserve the recognized set and fail-closed freshness messaging", () => {
  for (const journey of ["J1", "J3_R1", "J5", "J8"]) assert.match(zohoUi, new RegExp(`id: "${journey}"`));
  assert.match(zohoUi, /Template evidence incomplete: Tip and Guide remain fail-closed/);
  assert.match(zohoUi, /Current approved Guide URL required/);
  assert.match(zohoUi, /Guide usage remains unverified and fail-closed/);
  assert.match(zohoUi, /Task Tip and Guide are verified not used/);
  assert.match(zohoUi, /Journey triggering is disabled/);
});

test("Case Preview keeps one scroll region and responsive, unclipped Zoho navigation", () => {
  assert.match(dashboard, /max-h-\[96dvh\] max-w-\[1180px\]/);
  assert.match(dashboard, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(dashboard, /grid grid-cols-2 gap-1 sm:grid-cols-4/);
  assert.match(zohoUi, /sticky -top-4/);
  assert.match(zohoUi, /grid grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.match(zohoUi, /min-w-0/);
  assert.match(zohoUi, /sm:grid-cols-2/);
});

test("Case Preview keeps an accessible close control and Escape-to-close behavior", () => {
  assert.match(dashboard, /aria-label="Close panel"/);
  assert.match(dashboard, /if \(event\.key === "Escape"\) closePanel\(\)/);
  assert.match(dashboard, /window\.addEventListener\("keydown", handleModalKeyDown\)/);
  assert.match(dashboard, /window\.removeEventListener\("keydown", handleModalKeyDown\)/);
});
