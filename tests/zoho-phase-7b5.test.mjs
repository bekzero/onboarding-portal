import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EmailOnlyContactSyncError,
  evaluateEnrollmentContactSync,
  evaluateEnrollmentContactSyncReadiness,
  synchronizeEmailOnlyContact
} from "../lib/zoho-enrollment-sync-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const enabled = {
  automaticDispatchEnabled: true,
  communicationContextOwned: true,
  contactAutomationEnabled: true,
  contactSyncEnabled: true,
  eventEmissionEnabled: true,
  evidenceReference: "CRM-2026-117",
  globalKillSwitch: false,
  individualStaffIdentity: true,
  permissionConfirmed: true,
  planAutomationActive: true,
  productionApproved: true,
  productionMode: true,
  syncOnEnrollmentEnabled: true
};

const readinessBase = {
  ...enabled,
  alreadySynchronized: false,
  contactValid: true,
  providerConfigurationReady: true,
  subscriptionStatus: "UNKNOWN"
};

test("permission and evidence gates distinguish ordinary, incomplete, and attributable enrollment", () => {
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, permissionConfirmed: false }).classification, "MISSING_PERMISSION");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, evidenceReference: "" }).classification, "MISSING_EVIDENCE");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, individualStaffIdentity: false }).classification, "STAFF_IDENTITY_REQUIRED");
  assert.deepEqual(evaluateEnrollmentContactSync({ ...enabled, individualStaffIdentity: false }), {
    action: "SKIP",
    reason: "INDIVIDUAL_STAFF_IDENTITY_REQUIRED"
  });
});

test("invalid, historical, duplicate, and withdrawn contact state never reports ready", () => {
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, contactValid: false }).classification, "INVALID_CONTACT");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, permissionConfirmed: false, evidenceReference: "" }).eligibleIfEnabled, false);
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, alreadySynchronized: true }).classification, "ALREADY_SYNCHRONIZED");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, alreadySynchronized: true }).wouldPrepareNow, false);
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, permissionConfirmed: false }).wouldPrepareNow, false);
});

test("plan, contact, context, and suppression gates remain fail closed", () => {
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, planAutomationActive: false }).classification, "PLAN_NOT_READY");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, contactAutomationEnabled: false }).classification, "PLAN_NOT_READY");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, communicationContextOwned: false }).classification, "PLAN_NOT_READY");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, subscriptionStatus: "INELIGIBLE" }).classification, "BLOCKED");
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, providerConfigurationReady: false }).classification, "BLOCKED");
});

test("disabled production controls report disabled without a misleading ready state", () => {
  const result = evaluateEnrollmentContactSyncReadiness({
    ...readinessBase,
    automaticDispatchEnabled: false,
    contactSyncEnabled: false,
    eventEmissionEnabled: false,
    globalKillSwitch: true,
    productionApproved: false,
    productionMode: false,
    syncOnEnrollmentEnabled: false
  });
  assert.equal(result.classification, "AUTOMATION_DISABLED");
  assert.equal(result.eligibleIfEnabled, true);
  assert.equal(result.wouldPrepareNow, false);
  for (const reason of [
    "MSP_ENROLLMENT_SYNC_DISABLED",
    "EVENT_EMISSION_DISABLED",
    "GLOBAL_KILL_SWITCH_ENABLED",
    "CONTACT_SYNCHRONIZATION_DISABLED",
    "PRODUCTION_DISPATCH_NOT_APPROVED"
  ]) assert.ok(result.flagBlockers.includes(reason));
});

test("an explicitly enabled eligible preparation is held by the global kill switch", () => {
  const decision = evaluateEnrollmentContactSync({ ...enabled, globalKillSwitch: true });
  assert.deepEqual(decision, {
    action: "PREPARE",
    holdReason: "GLOBAL_KILL_SWITCH_ENABLED",
    status: "HELD"
  });
  assert.equal(evaluateEnrollmentContactSyncReadiness({ ...readinessBase, globalKillSwitch: true }).classification, "AUTOMATION_DISABLED");
});

test("provider failures and delayed visibility remain safe and verification-only retries do not write", async () => {
  await assert.rejects(synchronizeEmailOnlyContact({
    add: async () => { throw new Error("mock timeout"); },
    check: async () => ({ complete: true, listStatuses: [] })
  }), /mock timeout/);

  const pending = await synchronizeEmailOnlyContact({
    add: async () => ({ results: [{ classification: "ACCEPTED", providerCode: "0" }] }),
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(pending.classification, "PENDING_VERIFICATION");

  let writes = 0;
  const retry = await synchronizeEmailOnlyContact({
    add: async () => { writes += 1; return { results: [] }; },
    check: async () => ({ complete: true, listStatuses: [] }),
    verificationOnly: true
  });
  assert.equal(retry.classification, "PENDING_VERIFICATION");
  assert.equal(writes, 0);
});

test("unsubscribed and bounced contacts cannot be added", async () => {
  for (const status of ["unsub", "bounce"]) {
    let writes = 0;
    await assert.rejects(synchronizeEmailOnlyContact({
      add: async () => { writes += 1; return { results: [] }; },
      check: async () => ({ complete: true, listStatuses: [status] })
    }), (error) => error instanceof EmailOnlyContactSyncError && error.reason === "SUPPRESSED_CONTACT");
    assert.equal(writes, 0);
  }
});

test("dry-run route is authenticated, read-only, and returns no executable work", async () => {
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /getAdminApiAuthError/);
  assert.match(route, /dryRun: true/);
  assert.doesNotMatch(route, /prepareMspEnrollmentContactSync|createZohoContactSyncEvent|addLeadsInBulk|prisma\./);
});

test("readiness service uses authoritative persisted owner, audit, context, event, and configuration", async () => {
  const service = await read("lib/zoho-admin-center.ts");
  for (const evidence of [
    "msp_enrollment.contact_permission_recorded",
    "ONBOARDING_OWNER",
    "zohoCommunicationContext.findUnique",
    "zohoOutboxEvent.findFirst",
    "evaluateEnrollmentContactSyncReadiness",
    "includePermissionEvidenceReference"
  ]) assert.match(service, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("HELD events are durable, not claimable, and every future dispatch revalidates state", async () => {
  const dispatcher = await read("lib/zoho-dispatcher.ts");
  assert.match(dispatcher, /event\."status" IN \('PENDING', 'RETRY'\)/);
  assert.doesNotMatch(dispatcher, /event\."status" IN \([^\n]*'HELD'/);
  assert.match(dispatcher, /loadDispatchState\(claim\.event\)/);
  assert.match(dispatcher, /contactPermissionRecorded/);
  assert.match(dispatcher, /RECIPIENT_INELIGIBLE/);
  assert.match(dispatcher, /ACCEPTED_PENDING_VERIFICATION/);
});

test("stable enrollment identity and unique outbox keys prevent duplicate preparation", async () => {
  const enrollment = await read("lib/zoho-enrollment-sync.ts");
  const schema = await read("prisma/schema.prisma");
  assert.match(enrollment, /createStableZohoKey\("contact-sync", "msp-enrolled", plan\.planId, contact\.normalizedEmail\)/);
  assert.match(schema, /eventKey\s+String\s+@unique/);
  assert.match(schema, /@@unique\(\[onboardingPlanId, normalizedEmail, role\]\)/);
  assert.match(enrollment, /eventCreated: event\.created/);
});

test("case preview presents a compact read-only evaluation without exposing shared evidence", async () => {
  const ui = await read("components/zoho-integration-status.tsx");
  assert.match(ui, /Evaluate Zoho Sync/);
  assert.match(ui, /No event or provider request was created/);
  assert.match(ui, /Eligible if explicitly enabled/);
  assert.match(ui, /Blocked by:/);
  assert.match(ui, /permissionEvidenceReference/);
  assert.match(ui, /enrollmentContactSync\.mspName/);
  assert.match(ui, /enrollmentContactSync\.primaryContactEmail/);
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/route.ts");
  assert.match(route, /includePermissionEvidenceReference: Boolean\(staffIdentity\)/);
  const service = await read("lib/zoho-admin-center.ts");
  assert.match(service, /mspName: plan\.msp\.name/);
});

test("production automation remains disabled and no Phase 7B.5 provider call exists", async () => {
  const env = await read(".env.example");
  for (const line of [
    "ZOHO_MSP_ENROLLMENT_CONTACT_SYNC_ENABLED=false",
    "ZOHO_EVENT_EMISSION_ENABLED=false",
    "ZOHO_GLOBAL_KILL_SWITCH=true",
    "ZOHO_CONTACT_SYNC_ENABLED=false",
    "ZOHO_AUTOMATIC_DISPATCH_ENABLED=false",
    "ZOHO_JOURNEY_TRIGGERING_ENABLED=false"
  ]) assert.match(env, new RegExp(line));
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/route.ts");
  assert.doesNotMatch(route, /getZohoApiClient|zohoDispatchProvider|triggerJourney/);
});
