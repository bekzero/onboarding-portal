import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../components/zoho-integration-status.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");

test("normal Case Preview presents one plain-language automated-email workflow", () => {
  for (const label of [
    "Automated Emails",
    "Email recipient",
    "Current stage",
    "Next scheduled email",
    "Last KZero-triggered email",
    "Email activity",
    "Enable Automated Emails",
    "Disable Automated Emails"
  ]) assert.ok(ui.includes(label), `Missing ${label}`);

  for (const technicalControl of [
    "Run Single-Contact Pilot",
    "Prepare Full-Field Intent",
    "Dispatch Exact Test Event",
    "Dispatch Exact Contact Event",
    "Dispatch Exact J1 Event",
    "Advanced Diagnostics"
  ]) assert.ok(!ui.includes(technicalControl), `${technicalControl} must not appear in normal Case Preview`);
});

test("status copy distinguishes plan enablement, paused sending, held work, and external Zoho sends", () => {
  for (const label of [
    "Enabled for this MSP",
    "System sending paused",
    "No KZero email scheduled",
    "No KZero-triggered email recorded",
    "Emails started directly in Zoho are not included in this history."
  ]) assert.ok(ui.includes(label), `Missing ${label}`);
  assert.match(ui, /status\.heldEmail\?\.message/);
});

test("opening the screen performs only its read-only status request", () => {
  const effect = ui.slice(ui.indexOf("const load = useCallback"), ui.indexOf("async function changeAutomation"));
  assert.match(effect, /email-automation/);
  assert.match(effect, /cache: "no-store"/);
  assert.doesNotMatch(effect, /method: "POST"/);
  assert.match(ui, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
});

test("enable and disable retain explicit confirmation and one plan-scoped endpoint", () => {
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /action: "ENABLE" \| "DISABLE"/);
  assert.match(ui, /JSON\.stringify\(\{ action, confirmed: true \}\)/);
  assert.match(ui, /method: "POST"/);
  assert.match(ui, /encodeURIComponent\(planId\).*email-automation/s);
  assert.match(ui, /disabled=\{busy \|\| !status\?\.canManage/);
});

test("ordinary administrators see plain errors and never raw event identifiers or provider payloads", () => {
  assert.match(ui, /contact KZero support/);
  assert.match(ui, /provider accepted; delivery not independently confirmed/);
  assert.doesNotMatch(ui, /event\.id|eventId|ListKey|triggerKey|journeyKey|lastSanitizedError/);
  assert.match(ui, /Open Support Diagnostics/);
});

test("responsive cards wrap long values and keep the existing Case Preview modal behavior", () => {
  assert.match(ui, /break-all/);
  assert.match(ui, /min-w-0/);
  assert.match(ui, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(ui, /flex flex-col gap-4 sm:flex-row/);
  assert.match(dashboard, /max-h-\[96dvh\] max-w-\[1180px\]/);
  assert.match(dashboard, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(dashboard, /aria-label="Close panel"/);
  assert.match(dashboard, /if \(event\.key === "Escape"\) closePanel\(\)/);
});

test("activity supports pending, succeeded, failed, held, retry, and cancelled states", () => {
  for (const state of ["PENDING", "SUCCEEDED", "DEAD", "HELD", "RETRY", "CANCELLED"]) {
    assert.ok(ui.includes(state), `Missing ${state} presentation`);
  }
});
