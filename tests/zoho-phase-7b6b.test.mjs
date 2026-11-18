import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyPilotMembership,
  evaluateSingleContactPilotReadiness,
  executeSingleContactPilotCore
} from "../lib/zoho-single-contact-pilot-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ready = {
  automaticDispatchEnabled: false,
  communicationContextOwned: true,
  contactSyncEnabled: false,
  dispatchMode: "disabled",
  downstreamAutomationVerified: true,
  eventEmissionEnabled: false,
  globalKillSwitch: false,
  journeyTriggeringEnabled: false,
  listPrivacyVerified: true,
  manualPilotEnabled: true,
  nudgeEvaluationEnabled: false,
  permissionConfirmed: true,
  pilotTargetConfigured: true,
  pilotTargetMatches: true,
  planAndOwnerApproved: true,
  priorReservation: false,
  productionApproved: false,
  providerConfigured: true,
  staffAdminAuthorized: true,
  subscriptionStatus: "CONFIRMED",
  syncOnEnrollmentEnabled: false,
  testWritePathsEnabled: false,
  unresolvedEnrollmentEvent: false
};

test("execution needs exact target, Staff ADMIN, permission, context, approval, and private provider readiness", () => {
  assert.equal(evaluateSingleContactPilotReadiness(ready).canExecute, true);
  for (const [field, blocker] of [
    ["pilotTargetMatches", "PILOT_TARGET_NOT_ALLOWLISTED"],
    ["staffAdminAuthorized", "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED"],
    ["permissionConfirmed", "CONTACT_PERMISSION_NOT_DOCUMENTED"],
    ["planAndOwnerApproved", "AUTOMATION_APPROVAL_REQUIRED"],
    ["communicationContextOwned", "COMMUNICATION_CONTEXT_REQUIRED"],
    ["listPrivacyVerified", "LIST_PRIVACY_UNVERIFIED"],
    ["downstreamAutomationVerified", "DOWNSTREAM_AUTOMATION_UNVERIFIED"]
  ]) {
    assert.ok(evaluateSingleContactPilotReadiness({ ...ready, [field]: false }).blockers.includes(blocker));
  }
});

test("UNKNOWN, manual review, and ineligible subscription states fail closed", () => {
  for (const status of ["UNKNOWN", "PENDING_CONFIRMATION", "MANUAL_REVIEW", null]) {
    assert.ok(evaluateSingleContactPilotReadiness({ ...ready, subscriptionStatus: status }).blockers.includes("SUBSCRIPTION_STATUS_UNVERIFIED"));
  }
  assert.ok(evaluateSingleContactPilotReadiness({ ...ready, subscriptionStatus: "INELIGIBLE" }).blockers.includes("RECIPIENT_INELIGIBLE"));
});

test("global kill switch and dormant flag independently block provider writes", () => {
  assert.ok(evaluateSingleContactPilotReadiness({ ...ready, globalKillSwitch: true }).blockers.includes("GLOBAL_KILL_SWITCH_ENABLED"));
  assert.ok(evaluateSingleContactPilotReadiness({ ...ready, manualPilotEnabled: false }).blockers.includes("SINGLE_CONTACT_PILOT_DISABLED"));
});

test("any automatic path prevents an isolated manual maintenance window", () => {
  for (const patch of [
    { automaticDispatchEnabled: true }, { contactSyncEnabled: true }, { eventEmissionEnabled: true },
    { journeyTriggeringEnabled: true }, { productionApproved: true }, { syncOnEnrollmentEnabled: true },
    { nudgeEvaluationEnabled: true }, { testWritePathsEnabled: true }, { dispatchMode: "production" }
  ]) assert.ok(evaluateSingleContactPilotReadiness({ ...ready, ...patch }).blockers.includes("AUTOMATIC_PATH_ISOLATION_REQUIRED"));
});

test("complete active membership returns ALREADY_EXISTS without a write", async () => {
  let adds = 0;
  const records = [];
  const result = await executeSingleContactPilotCore({
    add: async () => { adds += 1; return { classification: "ACCEPTED", providerCode: "0" }; },
    check: async () => ({ complete: true, listStatuses: ["active"] }),
    record: async (stage, outcome) => records.push({ stage, outcome }),
    reserve: async () => ({ acquired: true })
  });
  assert.equal(result.outcome, "ALREADY_EXISTS");
  assert.equal(adds, 0);
  assert.equal(records[0].stage, "membership_precheck");
});

test("unsubscribed and bounced contacts are blocked without writes", async () => {
  for (const status of ["unsub", "bounce"]) {
    let adds = 0;
    const result = await executeSingleContactPilotCore({
      add: async () => { adds += 1; return { classification: "ACCEPTED", providerCode: "0" }; },
      check: async () => ({ complete: true, listStatuses: [status] }),
      record: async () => {}, reserve: async () => ({ acquired: true })
    });
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(adds, 0);
  }
});

test("incomplete scans fail closed without reservation or write", async () => {
  let reserved = false;
  let adds = 0;
  const result = await executeSingleContactPilotCore({
    add: async () => { adds += 1; return { classification: "ACCEPTED", providerCode: "0" }; },
    check: async () => ({ complete: false, listStatuses: [] }), record: async () => {},
    reserve: async () => { reserved = true; return { acquired: true }; }
  });
  assert.equal(result.outcome, "UNABLE_TO_VERIFY");
  assert.equal(reserved, false);
  assert.equal(adds, 0);
});

test("membership provider failure fails closed before reservation", async () => {
  let reserved = false;
  const result = await executeSingleContactPilotCore({
    add: async () => ({ classification: "ACCEPTED", providerCode: "0" }),
    check: async () => { throw new Error("provider unavailable"); },
    record: async () => {}, reserve: async () => { reserved = true; return { acquired: true }; }
  });
  assert.equal(result.outcome, "UNABLE_TO_VERIFY");
  assert.equal(reserved, false);
});

test("accepted writes are VERIFIED only after a complete active membership check", async () => {
  let checks = 0;
  const result = await executeSingleContactPilotCore({
    add: async () => ({ classification: "ACCEPTED", providerCode: "0" }),
    check: async () => ({ complete: true, listStatuses: checks++ === 0 ? [] : ["active"] }),
    record: async () => {}, reserve: async () => ({ acquired: true })
  });
  assert.deepEqual(result, { outcome: "VERIFIED", providerWriteAttempted: true });
});

test("delayed visibility produces ACCEPTED_PENDING_VERIFICATION", async () => {
  const result = await executeSingleContactPilotCore({
    add: async () => ({ classification: "ACCEPTED", providerCode: "0" }),
    check: async () => ({ complete: true, listStatuses: [] }), record: async () => {}, reserve: async () => ({ acquired: true })
  });
  assert.equal(result.outcome, "ACCEPTED_PENDING_VERIFICATION");
});

test("a suppression state observed after provider acceptance remains blocked", async () => {
  let checks = 0;
  const result = await executeSingleContactPilotCore({
    add: async () => ({ classification: "ACCEPTED", providerCode: "0" }),
    check: async () => ({ complete: true, listStatuses: checks++ === 0 ? [] : ["unsub"] }),
    record: async () => {}, reserve: async () => ({ acquired: true })
  });
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.providerWriteAttempted, true);
});

test("HTTP-200 application errors and ignored results are accurately classified", async () => {
  for (const [classification, outcome] of [["ERROR", "FAILED"], ["IGNORED", "IGNORED"]]) {
    const result = await executeSingleContactPilotCore({
      add: async () => ({ classification, providerCode: "PROVIDER_CODE" }),
      check: async () => ({ complete: true, listStatuses: [] }), record: async () => {}, reserve: async () => ({ acquired: true })
    });
    assert.equal(result.outcome, outcome);
  }
});

test("a network timeout after reservation is uncertain and never retried", async () => {
  let reserved = false;
  let adds = 0;
  const reserve = async () => reserved ? { acquired: false } : (reserved = true, { acquired: true });
  const first = await executeSingleContactPilotCore({
    add: async () => { adds += 1; throw new Error("timeout"); },
    check: async () => ({ complete: true, listStatuses: [] }), record: async () => {}, reserve
  });
  const second = await executeSingleContactPilotCore({
    add: async () => { adds += 1; return { classification: "ACCEPTED", providerCode: "0" }; },
    check: async () => ({ complete: true, listStatuses: [] }), record: async () => {}, reserve
  });
  assert.equal(first.outcome, "UNABLE_TO_VERIFY");
  assert.equal(second.outcome, "ACCEPTED_PENDING_VERIFICATION");
  assert.equal(adds, 1);
});

test("concurrent callers share a durable reservation and only one can write", async () => {
  let reserved = false;
  let adds = 0;
  const reserve = async () => reserved ? { acquired: false } : (reserved = true, { acquired: true });
  await Promise.all([1, 2].map(() => executeSingleContactPilotCore({
    add: async () => { adds += 1; return { classification: "ACCEPTED", providerCode: "0" }; },
    check: async () => ({ complete: true, listStatuses: [] }), record: async () => {}, reserve
  })));
  assert.equal(adds, 1);
});

test("membership classifier distinguishes suppression, active membership, absence, and uncertainty", () => {
  assert.equal(classifyPilotMembership({ complete: false, listStatuses: [] }).outcome, "UNABLE_TO_VERIFY");
  assert.equal(classifyPilotMembership({ complete: true, listStatuses: ["bounce"] }).outcome, "BLOCKED");
  assert.equal(classifyPilotMembership({ complete: true, listStatuses: ["active"] }).outcome, "ALREADY_EXISTS");
  assert.equal(classifyPilotMembership({ complete: true, listStatuses: [] }).outcome, null);
});

test("routes enforce Staff ADMIN and trusted same-origin authorization without browser targeting", async () => {
  const preview = await read("app/api/admin/zoho/automation/plans/[planId]/pilot/preview/route.ts");
  const execute = await read("app/api/admin/zoho/automation/plans/[planId]/pilot/execute/route.ts");
  for (const route of [preview, execute]) assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.doesNotMatch(execute, /body\.(email|listKey|planId)/);
  assert.match(execute, /getSensitiveAdminAuditActor/);
});

test("server execution uses exact configured target, one email, fresh privacy, durable lock, and no outbox", async () => {
  const service = await read("lib/zoho-single-contact-pilot.ts");
  assert.match(service, /loadConfiguredPilotPlan/);
  assert.match(service, /emails: \[state\.owner\.email\]/);
  assert.match(service, /list\.listKey === listKey && list\.listName === ZOHO_TEST_MAILING_LIST_NAME/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /PILOT_RESERVATION_ACTION/);
  assert.doesNotMatch(service, /createZohoOutboxEvent/);
});

test("UI shows compact preview, exact confirmation, outcomes, and no browser ListKey", async () => {
  const ui = await read("components/zoho-integration-status.tsx");
  assert.match(ui, /Controlled Contact Sync Pilot/);
  assert.match(ui, /Preview Sync/);
  assert.match(ui, /Run Single-Contact Pilot/);
  assert.match(ui, /RUN SINGLE-CONTACT ZOHO PILOT/);
  assert.doesNotMatch(ui, /listKey:/);
});

test("configuration is dormant by default and documents the manual flag", async () => {
  const [config, env] = await Promise.all([read("lib/zoho-config.ts"), read(".env.example")]);
  assert.match(config, /enabled\("ZOHO_SINGLE_CONTACT_PILOT_ENABLED"\)/);
  assert.match(env, /ZOHO_SINGLE_CONTACT_PILOT_ENABLED=false/);
});
