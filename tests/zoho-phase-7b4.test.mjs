import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EmailOnlyContactSyncError,
  evaluateEnrollmentContactSync,
  shouldRecordEnrollmentContactPermission,
  synchronizeEmailOnlyContact,
  validateEnrollmentContactPermission
} from "../lib/zoho-enrollment-sync-core.ts";

const safeBase = {
  automaticDispatchEnabled: true,
  communicationContextOwned: true,
  contactAutomationEnabled: true,
  contactSyncEnabled: true,
  eventEmissionEnabled: true,
  evidenceReference: "crm-note-123",
  globalKillSwitch: false,
  individualStaffIdentity: true,
  permissionConfirmed: true,
  planAutomationActive: true,
  productionApproved: true,
  productionMode: true,
  syncOnEnrollmentEnabled: true
};

test("consented, fully approved enrollment contact sync can become pending", () => {
  assert.deepEqual(evaluateEnrollmentContactSync(safeBase), {
    action: "PREPARE",
    holdReason: null,
    status: "PENDING"
  });
});

test("missing permission evidence and disabled flags create no latent work", () => {
  assert.deepEqual(evaluateEnrollmentContactSync({ ...safeBase, evidenceReference: "" }), {
    action: "SKIP",
    reason: "CONTACT_PERMISSION_NOT_DOCUMENTED"
  });
  assert.deepEqual(evaluateEnrollmentContactSync({ ...safeBase, syncOnEnrollmentEnabled: false }), {
    action: "SKIP",
    reason: "MSP_ENROLLMENT_SYNC_DISABLED"
  });
  assert.deepEqual(evaluateEnrollmentContactSync({ ...safeBase, eventEmissionEnabled: false }), {
    action: "SKIP",
    reason: "EVENT_EMISSION_DISABLED"
  });
});

test("permission evidence is optional unless confirmation is selected", () => {
  assert.deepEqual(validateEnrollmentContactPermission(), {
    confirmed: false,
    evidenceReference: "",
    valid: true
  });
  assert.equal(validateEnrollmentContactPermission({ confirmed: true }).valid, false);
  assert.deepEqual(validateEnrollmentContactPermission({
    confirmed: true,
    evidenceReference: "  CRM-123  "
  }), {
    confirmed: true,
    evidenceReference: "CRM-123",
    valid: true
  });
});

test("repeated permission submissions do not create duplicate decisions", () => {
  assert.equal(shouldRecordEnrollmentContactPermission({
    evidenceReference: "  CRM-123  ",
    existingEvidenceReferences: [null, "CRM-123"]
  }), false);
  assert.equal(shouldRecordEnrollmentContactPermission({
    evidenceReference: "SUPPORT-456",
    existingEvidenceReferences: ["CRM-123"]
  }), true);
});

test("kill switch, plan approval, and context gates prepare held work only", () => {
  assert.equal(evaluateEnrollmentContactSync({ ...safeBase, globalKillSwitch: true }).status, "HELD");
  assert.equal(evaluateEnrollmentContactSync({ ...safeBase, planAutomationActive: false }).holdReason, "AUTOMATION_APPROVAL_REQUIRED");
  assert.equal(evaluateEnrollmentContactSync({ ...safeBase, communicationContextOwned: false }).holdReason, "COMMUNICATION_CONTEXT_REQUIRED");
});

test("shared admin evidence is retained but cannot prepare outbox work", () => {
  assert.deepEqual(evaluateEnrollmentContactSync({ ...safeBase, individualStaffIdentity: false }), {
    action: "SKIP",
    reason: "INDIVIDUAL_STAFF_IDENTITY_REQUIRED"
  });
});

test("existing active contacts are idempotent and do not call addleadsinbulk", async () => {
  let writes = 0;
  const result = await synchronizeEmailOnlyContact({
    add: async () => { writes += 1; return { results: [] }; },
    check: async () => ({ complete: true, listStatuses: ["active"] })
  });
  assert.deepEqual(result, { classification: "EXISTING", code: "0" });
  assert.equal(writes, 0);
});

test("unsubscribed and bounced contacts are never resubscribed", async () => {
  let writes = 0;
  for (const status of ["unsub", "bounce"]) {
    await assert.rejects(synchronizeEmailOnlyContact({
      add: async () => { writes += 1; return { results: [] }; },
      check: async () => ({ complete: true, listStatuses: [status] })
    }), (error) => error instanceof EmailOnlyContactSyncError && error.reason === "SUPPRESSED_CONTACT");
  }
  assert.equal(writes, 0);
});

test("accepted email-only writes require a complete post-write membership check", async () => {
  const scans = [
    { complete: true, listStatuses: [] },
    { complete: true, listStatuses: ["active"] }
  ];
  const result = await synchronizeEmailOnlyContact({
    add: async () => ({ results: [{ classification: "ACCEPTED", providerCode: "0" }] }),
    check: async () => scans.shift()
  });
  assert.deepEqual(result, { classification: "VERIFIED", code: "0" });

  const pending = await synchronizeEmailOnlyContact({
    add: async () => ({ results: [{ classification: "ACCEPTED", providerCode: "0" }] }),
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(pending.classification, "PENDING_VERIFICATION");
});

test("accepted-but-unverified retries perform verification only", async () => {
  let writes = 0;
  const result = await synchronizeEmailOnlyContact({
    add: async () => {
      writes += 1;
      return { results: [{ classification: "ACCEPTED", providerCode: "0" }] };
    },
    check: async () => ({ complete: true, listStatuses: [] }),
    verificationOnly: true
  });
  assert.deepEqual(result, {
    classification: "PENDING_VERIFICATION",
    code: "PENDING_VERIFICATION"
  });
  assert.equal(writes, 0);
});

test("failed requests propagate for the dispatcher retry policy", async () => {
  let attempts = 0;
  const operation = () => synchronizeEmailOnlyContact({
    add: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("mock provider failure");
      return { results: [{ classification: "EXISTING", providerCode: "0" }] };
    },
    check: async () => ({ complete: true, listStatuses: [] })
  });
  await assert.rejects(operation(), /mock provider failure/);
  assert.equal((await operation()).classification, "EXISTING");
  assert.equal(attempts, 2);
});

test("enrollment integration reuses the primary PlanContact and is post-commit", async () => {
  const persistence = await readFile(new URL("../lib/msp-persistence.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/msps/route.ts", import.meta.url), "utf8");
  assert.match(persistence, /planContacts:\s*\{\s*create:/s);
  assert.match(persistence, /prepareMspEnrollmentContactSync/);
  assert.ok(persistence.indexOf("prepareMspEnrollmentContactSync({") > persistence.indexOf("const msp = await prisma.$transaction"));
  assert.match(persistence, /catch\s*\{[\s\S]*PREPARATION_FAILED/);
  assert.match(route, /zohoContactPermission/);
  assert.match(route, /validateEnrollmentContactPermission/);
  assert.match(route, /formatStaffAuditActor\(staffIdentity\)/);
  assert.match(route, /zohoAuditActorAttributable: Boolean\(staffIdentity\)/);
  assert.match(persistence, /recordMspEnrollmentContactSyncPreparationFailure/);
});

test("Enroll and Edit MSP render optional Zoho permission controls", async () => {
  const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");
  const editStart = dashboard.indexOf('{panelMode === "edit" && selectedCase && editState ? (');
  const enrollStart = dashboard.indexOf('{panelMode === "enroll" ? (', editStart);
  const enrollEnd = dashboard.indexOf('onClick={handleEnroll}', enrollStart);
  assert.ok(editStart >= 0 && enrollStart > editStart && enrollEnd > enrollStart);
  const editPanel = dashboard.slice(editStart, enrollStart);
  const enrollPanel = dashboard.slice(enrollStart, enrollEnd);
  assert.match(editPanel, /Zoho Partner Onboarding/);
  assert.match(editPanel, /Current documented permission status|Permission documented/);
  assert.match(editPanel, /Record Permission Evidence/);
  assert.match(dashboard, /onboardingPlanId\)}\/permission/);
  assert.match(enrollPanel, /Zoho Partner Onboarding/);
  assert.match(enrollPanel, /I confirm that appropriate permission has been obtained to add this contact to Zoho Marketing Automation\./);
  assert.match(enrollPanel, /Permission Evidence Reference/);
  assert.match(enrollPanel, /CRM note, support ticket, or consent record reference/);
  assert.match(enrollPanel, /Recording permission does not automatically subscribe the contact or trigger onboarding emails\./);
  assert.match(dashboard, /zohoContactPermissionConfirmed: false/);
  assert.match(dashboard, /if \(enrollmentState\.zohoContactPermissionConfirmed && !permissionEvidenceReference\)/);
  assert.match(dashboard, /zohoContactPermission:\s*\{\s*confirmed: enrollmentState\.zohoContactPermissionConfirmed,\s*evidenceReference: permissionEvidenceReference/s);
});

test("existing MSP permission recording is audited, idempotent, and cannot prepare Zoho work", async () => {
  const service = await readFile(new URL("../lib/zoho-enrollment-sync.ts", import.meta.url), "utf8");
  const route = await readFile(
    new URL("../app/api/admin/zoho/automation/plans/[planId]/permission/route.ts", import.meta.url),
    "utf8"
  );
  const functionStart = service.indexOf("export async function recordExistingMspContactPermission");
  const functionBody = service.slice(functionStart);
  assert.ok(functionStart >= 0);
  assert.match(functionBody, /pg_advisory_xact_lock/);
  assert.match(functionBody, /shouldRecordEnrollmentContactPermission/);
  assert.match(functionBody, /createZohoAutomationAuditInTransaction/);
  assert.doesNotMatch(functionBody, /createZohoContactSyncEventInTransaction\(/);
  assert.doesNotMatch(functionBody, /prepareMspEnrollmentContactSync\(/);
  assert.match(route, /getAdminApiAuthError\("SALES_ENGINEER"\)/);
  assert.match(route, /isTrustedSameOriginRequest/);
  assert.match(route, /formatStaffAuditActor\(staffIdentity\) : getAdminAuditActor\(\)/);
  assert.match(route, /validateEnrollmentContactPermission/);
});

test("Enroll MSP modal keeps a bounded single scroller, persistent footer, and responsive section layout", async () => {
  const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");
  const enrollStart = dashboard.indexOf('{panelMode === "enroll" ? (');
  const enrollEnd = dashboard.indexOf("</Card>", enrollStart);
  const enrollPanel = dashboard.slice(enrollStart, enrollEnd);

  assert.match(dashboard, /panelMode === "edit" \|\| panelMode === "enroll"[\s\S]*?flex max-h-\[90vh\] max-w-\[940px\] flex-col p-0/);
  assert.match(enrollPanel, /min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5/);
  assert.doesNotMatch(enrollPanel, /pb-28|pb-32|min-h-\[|h-screen/);
  assert.match(enrollPanel, /grid gap-4 \[grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,26rem\),1fr\)\)\]/);
  assert.match(enrollPanel, /mt-3 grid gap-4 sm:grid-cols-2/);
  assert.match(enrollPanel, /mt-3 grid items-start gap-4 \[grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,26rem\),1fr\)\)\]/);
  assert.match(enrollPanel, /shrink-0 border-t border-border bg-surface/);
});

test("provider uses getleads plus addleadsinbulk and sends email only", async () => {
  const provider = await readFile(new URL("../lib/zoho-dispatch-provider.ts", import.meta.url), "utf8");
  const dispatcher = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(provider, /checkZohoListMembership/);
  assert.match(provider, /addLeadsInBulk\(\{ emails: \[email\], listKey \}\)/);
  assert.doesNotMatch(provider, /subscribeLead|topicId/);
  assert.match(dispatcher, /lastProviderOutcome === "ACCEPTED_PENDING_VERIFICATION"/);
  assert.match(dispatcher, /CONTACT_MEMBERSHIP_PENDING_VERIFICATION/);
  assert.match(dispatcher, /CONTACT_MEMBERSHIP_UNVERIFIED_AFTER_ACCEPTANCE/);
  assert.match(dispatcher, /actor: \{ startsWith: "oidc:" \}/);
});

test("production defaults remain disabled and consent readiness is visible", async () => {
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const ui = await readFile(new URL("../components/zoho-integration-status.tsx", import.meta.url), "utf8");
  assert.match(env, /ZOHO_MSP_ENROLLMENT_CONTACT_SYNC_ENABLED=false/);
  assert.match(env, /ZOHO_GLOBAL_KILL_SWITCH=true/);
  assert.match(env, /ZOHO_CONTACT_SYNC_ENABLED=false/);
  assert.match(ui, /Enrollment contact permission/);
  assert.match(ui, /Enrollment contact sync/);
});
