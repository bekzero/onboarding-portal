import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EmailOnlyContactSyncError,
  evaluateEnrollmentPilotReadiness,
  synchronizeEmailOnlyContact
} from "../lib/zoho-enrollment-sync-core.ts";
import {
  normalizeChangedRequiredEmailValue,
  normalizeRequiredEmailValue
} from "../lib/email-validation-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const eligible = {
  alreadySynchronized: false,
  automaticDispatchEnabled: false,
  communicationContextOwned: true,
  contactAutomationEnabled: true,
  contactValid: true,
  emailOnlyProviderReady: true,
  evidenceReference: "CRM-2026-117",
  globalKillSwitch: true,
  hasUnresolvedEnrollmentEvent: false,
  listPrivacyVerified: true,
  permissionConfirmed: true,
  pilotTargetConfigured: true,
  pilotTargetMatches: true,
  planAutomationActive: true,
  staffAdminAuthorized: true,
  subscriptionStatus: "PENDING_CONFIRMATION"
};

test("exactly targeted MSP/contact can be a future pilot candidate without a live action", () => {
  const result = evaluateEnrollmentPilotReadiness(eligible);
  assert.equal(result.classification, "ELIGIBLE_FOR_CONTROLLED_PILOT");
  assert.equal(result.candidateEligible, true);
  assert.equal(result.liveSynchronizationAvailable, false);
});

test("missing or mismatched server-side target fails closed", () => {
  assert.deepEqual(
    evaluateEnrollmentPilotReadiness({ ...eligible, pilotTargetConfigured: false }).blockers,
    ["PILOT_TARGET_NOT_CONFIGURED"]
  );
  const other = evaluateEnrollmentPilotReadiness({ ...eligible, pilotTargetMatches: false });
  assert.equal(other.classification, "NOT_TARGETED");
  assert.ok(other.blockers.includes("PILOT_TARGET_NOT_ALLOWLISTED"));
});

test("individually authenticated ADMIN is required and shared admin is rejected", () => {
  const result = evaluateEnrollmentPilotReadiness({ ...eligible, staffAdminAuthorized: false });
  assert.equal(result.candidateEligible, false);
  assert.ok(result.blockers.includes("INDIVIDUAL_ADMIN_IDENTITY_REQUIRED"));
});

test("permission and evidence remain independent mandatory gates", () => {
  assert.ok(evaluateEnrollmentPilotReadiness({ ...eligible, permissionConfirmed: false }).blockers.includes("CONTACT_PERMISSION_NOT_DOCUMENTED"));
  assert.ok(evaluateEnrollmentPilotReadiness({ ...eligible, evidenceReference: "" }).blockers.includes("PERMISSION_EVIDENCE_MISSING"));
});

test("invalid or mismatched primary contact is rejected instead of sanitized silently", () => {
  const result = evaluateEnrollmentPilotReadiness({ ...eligible, contactValid: false });
  assert.equal(result.candidateEligible, false);
  assert.ok(result.blockers.includes("INVALID_PRIMARY_CONTACT"));
});

test("plan, contact, context, and provider readiness are explicit", () => {
  const result = evaluateEnrollmentPilotReadiness({
    ...eligible,
    communicationContextOwned: false,
    contactAutomationEnabled: false,
    emailOnlyProviderReady: false,
    listPrivacyVerified: false,
    planAutomationActive: false
  });
  for (const blocker of [
    "AUTOMATION_APPROVAL_REQUIRED",
    "COMMUNICATION_CONTEXT_REQUIRED",
    "EMAIL_ONLY_PROVIDER_CONFIGURATION_INCOMPLETE",
    "LIST_PRIVACY_UNVERIFIED"
  ]) assert.ok(result.blockers.includes(blocker));
});

test("unsubscribed and bounced recipients remain blocked before writes", async () => {
  assert.ok(evaluateEnrollmentPilotReadiness({ ...eligible, subscriptionStatus: "INELIGIBLE" }).blockers.includes("RECIPIENT_INELIGIBLE"));
  for (const status of ["unsub", "bounce"]) {
    let writes = 0;
    await assert.rejects(synchronizeEmailOnlyContact({
      add: async () => { writes += 1; return { results: [] }; },
      check: async () => ({ complete: true, listStatuses: [status] })
    }), (error) => error instanceof EmailOnlyContactSyncError && error.reason === "SUPPRESSED_CONTACT");
    assert.equal(writes, 0);
  }
});

test("existing contacts and delayed visibility do not duplicate list-add requests", async () => {
  let writes = 0;
  const existing = await synchronizeEmailOnlyContact({
    add: async () => { writes += 1; return { results: [] }; },
    check: async () => ({ complete: true, listStatuses: ["active"] })
  });
  assert.equal(existing.classification, "EXISTING");
  assert.equal(writes, 0);

  const pending = await synchronizeEmailOnlyContact({
    add: async () => ({ results: [{ classification: "ACCEPTED", providerCode: "0" }] }),
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(pending.classification, "PENDING_VERIFICATION");
  const retry = await synchronizeEmailOnlyContact({
    add: async () => { writes += 1; return { results: [] }; },
    check: async () => ({ complete: true, listStatuses: [] }),
    verificationOnly: true
  });
  assert.equal(retry.classification, "PENDING_VERIFICATION");
  assert.equal(writes, 0);
});

test("historical HELD work prevents a pilot and cannot be released by this phase", async () => {
  const result = evaluateEnrollmentPilotReadiness({ ...eligible, hasUnresolvedEnrollmentEvent: true });
  assert.ok(result.blockers.includes("UNRESOLVED_ENROLLMENT_EVENT"));
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/route.ts");
  assert.doesNotMatch(route, /prepareMspEnrollmentContactSync|createZohoContactSyncEvent|dispatchZohoOutboxBatch/);
});

test("Phase 7B.6A requires the kill switch on and automatic dispatch off", () => {
  assert.ok(evaluateEnrollmentPilotReadiness({ ...eligible, globalKillSwitch: false }).blockers.includes("GLOBAL_KILL_SWITCH_MUST_REMAIN_ENABLED"));
  assert.ok(evaluateEnrollmentPilotReadiness({ ...eligible, automaticDispatchEnabled: true }).blockers.includes("AUTOMATIC_DISPATCH_MUST_REMAIN_DISABLED"));
});

test("current provider warning separates email-only readiness from full field and journey readiness", async () => {
  const service = await read("lib/zoho-admin-center.ts");
  assert.match(service, /emailOnlyProviderReady: configuration\.oauthConfigured && configuration\.listKeyPresent/);
  assert.match(service, /listPrivacyVerified: configuration\.listPrivacyVerified/);
  const ui = await read("components/zoho-integration-status.tsx");
  assert.doesNotMatch(ui, /Email-only list readiness|Field \/ private-list verification|Configured journeys/);
  assert.match(ui, /Email automation needs attention/);
  assert.match(ui, /contact KZero support/);
});

test("future enrollment rejects semicolon-tainted email while preserving historical records", async () => {
  assert.throws(() => normalizeRequiredEmailValue("simon@mspstrategy.ca;", "Primary contact email"), /valid primary contact email/i);
  assert.equal(
    normalizeChangedRequiredEmailValue("simon@mspstrategy.ca;", "simon@mspstrategy.ca;", "Primary contact email"),
    undefined
  );
  assert.throws(
    () => normalizeChangedRequiredEmailValue("changed@mspstrategy.ca;", "simon@mspstrategy.ca;", "Primary contact email"),
    /valid primary contact email/i
  );
  assert.equal(
    normalizeChangedRequiredEmailValue("changed@mspstrategy.ca", "simon@mspstrategy.ca;", "Primary contact email"),
    "changed@mspstrategy.ca"
  );
  const persistence = await read("lib/msp-persistence.ts");
  assert.match(persistence, /normalizeChangedRequiredEmail\(input\.primaryContactEmail, before\.primaryContactEmail/);
  assert.doesNotMatch(persistence, /replace\([^\n]*;/);
});

test("pilot preview route remains read-only while the normal UI omits pilot controls", async () => {
  const ui = await read("components/zoho-integration-status.tsx");
  assert.doesNotMatch(ui, /Single-contact pilot readiness|Sync Pilot Contact/);
  assert.match(ui, /Open Support Diagnostics/);
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/route.ts");
  assert.match(route, /dryRun: true/);
  assert.doesNotMatch(route, /getZohoApiClient|addLeadsInBulk|prisma\./);
});

test("pilot configuration is singular, server-only, and disabled automation defaults remain unchanged", async () => {
  const config = await read("lib/zoho-config.ts");
  assert.match(config, /ZOHO_MSP_ENROLLMENT_PILOT_PLAN_ID/);
  assert.match(config, /ZOHO_MSP_ENROLLMENT_PILOT_EMAIL/);
  assert.doesNotMatch(config, /ZOHO_MSP_ENROLLMENT_PILOT_EMAIL_ALLOWLIST/);
  const env = await read(".env.example");
  for (const setting of [
    "ZOHO_MSP_ENROLLMENT_CONTACT_SYNC_ENABLED=false",
    "ZOHO_EVENT_EMISSION_ENABLED=false",
    "ZOHO_GLOBAL_KILL_SWITCH=true",
    "ZOHO_CONTACT_SYNC_ENABLED=false",
    "ZOHO_AUTOMATIC_DISPATCH_ENABLED=false",
    "ZOHO_PRODUCTION_DISPATCH_APPROVED=false",
    "ZOHO_JOURNEY_TRIGGERING_ENABLED=false"
  ]) assert.match(env, new RegExp(setting));
});

test("pilot readiness controls require an individual ADMIN and explicit supported action", async () => {
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/readiness-controls/route.ts");
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /getSensitiveAdminAuditActor/);
  assert.match(route, /body\.confirmed !== true/);
  assert.match(route, /APPROVE_AUTOMATION/);
  assert.match(route, /ASSIGN_CONTEXT/);
  assert.match(route, /VERIFY_LIST_PRIVACY/);
});

test("plan and owner approval is exact-pilot scoped, audited, and idempotent", async () => {
  const service = await read("lib/zoho-pilot-admin.ts");
  assert.match(service, /pilot\.planId !== planId \|\| pilot\.email !== primaryEmail/);
  assert.match(service, /automationOrigin !== "NATIVE"/);
  assert.match(service, /actor: \{ startsWith: "oidc:" \}/);
  assert.match(service, /automationEnrollmentState === "ACTIVE" && contact\.automationEnabled/);
  assert.match(service, /msp_pilot\.automation_approved/);
  assert.match(service, /automationEnabled: true/);
  assert.match(service, /assertPilotAdministrationSafeguards\(\)/);
  assert.match(service, /!dispatch\.globalKillSwitch/);
  assert.match(service, /isZohoEventEmissionEnabled\(\)/);
  assert.match(service, /getZohoMspEnrollmentSyncConfiguration\(\)\.enabled/);
});

test("context assignment protects competing owners and does not release existing contexts", async () => {
  const service = await read("lib/zoho-pilot-admin.ts");
  assert.match(service, /zoho-context:/);
  assert.match(service, /context\.state !== "UNASSIGNED"/);
  assert.match(service, /Another active plan uses this communication identity/);
  assert.match(service, /msp_pilot\.communication_context_assigned/);
  assert.doesNotMatch(service, /releaseRequestedAt|releasedAt|dispatchZoho|createZohoContactSyncEvent/);
});

test("list privacy verification uses exact read-only API evidence and stores no ListKey", async () => {
  const service = await read("lib/zoho-pilot-admin.ts");
  assert.match(service, /discoverMailingLists\(\{ maxPages: 10, pageSize: 100 \}\)/);
  assert.match(service, /list\.listKey === listKey && list\.listName === ZOHO_TEST_MAILING_LIST_NAME/);
  assert.match(service, /matches\[0\]\.isPublic !== false/);
  assert.match(service, /getmailinglists:is_public=false/);
  assert.doesNotMatch(service, /addLeadsInBulk|triggerJourney|subscribe/);
});

test("readiness controls refresh persisted state without creating outbox work", async () => {
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/readiness-controls/route.ts");
  assert.match(route, /getZohoPlanAutomationSummary/);
  assert.doesNotMatch(route, /createZohoContactSyncEvent|prepareMspEnrollmentContactSync|dispatchZohoOutboxBatch/);
  const center = await read("lib/zoho-admin-center.ts");
  assert.match(center, /listPrivacyVerified = configuration\.listPrivacyVerified \|\| Boolean\(listPrivacyAudit\)/);
  assert.match(center, /planAndOwnerApproved/);
  assert.match(center, /communicationContextAssigned/);
});

test("readiness controls remain server-side and are absent from normal Case Preview", async () => {
  const ui = await read("components/zoho-integration-status.tsx");
  const route = await read("app/api/admin/zoho/automation/plans/[planId]/readiness-controls/route.ts");
  assert.doesNotMatch(ui, /Administrative readiness controls|Approve Plan &amp; Owner|Assign Context|Verify List Privacy/);
  assert.match(route, /getSensitiveAdminApiAuthError\(request, "ADMIN"\)/);
  assert.match(route, /VERIFY_LIST_PRIVACY/);
});
