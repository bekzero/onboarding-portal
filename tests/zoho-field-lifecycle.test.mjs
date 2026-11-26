import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tasks } from "../lib/mock-data.ts";
import { createZohoContactSnapshot } from "../lib/zoho-contact-mapping.ts";
import {
  classifyZohoFieldLifecycle,
  getZohoJourneyFreshnessBlockers,
  ZOHO_JOURNEY_GUIDANCE_EVIDENCE,
  ZOHO_JOURNEY_FRESHNESS_FIELDS
} from "../lib/zoho-field-lifecycle.ts";
import { buildZohoLeadInfo, ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS } from "../lib/zoho-field-mapping.ts";
import { getZohoTaskGuidance } from "../lib/zoho-task-guidance.ts";
import { parseLeadFields, parseSubscribeResult } from "../lib/zoho-api-core.ts";
import { zohoAllLeadFields66Response } from "./fixtures/zoho-all-lead-fields-66.mjs";

const fields = parseLeadFields(zohoAllLeadFields66Response);
const orderedTasks = [...new Map(tasks.map((task) => [task.templateKey, task])).values()];

function task(key) {
  const result = orderedTasks.find((item) => item.templateKey === key);
  assert.ok(result, `Missing task ${key}`);
  return result;
}

function guidance(key) {
  const current = task(key);
  return getZohoTaskGuidance({ description: current.description ?? null, templateKey: key });
}

function snapshot(overrides = {}) {
  const kickoff = task("book-kickoff");
  const kickoffGuidance = guidance("book-kickoff");
  return createZohoContactSnapshot({
    appsApproved: 0,
    appsSubmitted: 0,
    contact: { email: "owner@example.com", firstName: "Alex", lastName: "Owner", role: "ONBOARDING_OWNER" },
    kickoffBookedAt: null,
    lastMspActivity: null,
    lastSeTouch: null,
    nextTask: {
      guideUrl: kickoffGuidance.guideUrl,
      minutes: 30,
      owner: kickoff.owner,
      since: null,
      status: kickoff.status,
      templateKey: kickoff.templateKey,
      tip: kickoffGuidance.tip,
      title: kickoff.title
    },
    nudgeStatus: "DONE",
    plan: { currentStage: "Kickoff", planId: "test-nfr", progress: 0, status: "active", tenantType: "nfr" },
    portalBaseUrl: "https://portal.example.com",
    salesEngineer: { bookingUrl: "https://booking.example.com/se", email: "se@example.com", name: "Sales Engineer" },
    ...overrides
  });
}

test("field lifecycle distinguishes values, zero, unavailable, clears, missing, and unsupported fields", () => {
  assert.equal(classifyZohoFieldLifecycle({ current: "new", previous: "old" }), "KNOWN_VALUE");
  assert.equal(classifyZohoFieldLifecycle({ current: "value", previous: null }), "KNOWN_VALUE");
  assert.equal(classifyZohoFieldLifecycle({ current: 4, previous: 0 }), "KNOWN_VALUE");
  assert.equal(classifyZohoFieldLifecycle({ current: 0, previous: 4 }), "KNOWN_ZERO");
  assert.equal(classifyZohoFieldLifecycle({ current: null, previous: null }), "UNKNOWN_OR_NOT_APPLICABLE");
  assert.equal(classifyZohoFieldLifecycle({ current: null, previous: "stale" }), "INTENTIONAL_CLEAR_UNVERIFIED");
  assert.equal(classifyZohoFieldLifecycle({ current: undefined }), "MISSING");
  assert.equal(classifyZohoFieldLifecycle({ current: "date", outboundSupported: false }), "PROVIDER_UNSUPPORTED");
});

test("the serializer preserves populated transitions and numeric zero while encoding unavailable optional values empty", () => {
  const current = snapshot();
  current["Next Task Tip"] = null;
  current["Next Task Guide URL"] = null;
  current["Apps Submitted"] = 0;
  current["Apps Approved"] = 0;
  const leadInfo = buildZohoLeadInfo(current, fields);
  assert.equal(leadInfo["Next Task Tip"], "");
  assert.equal(leadInfo["Next Task Guide URL"], "");
  assert.equal(leadInfo["Apps Submitted"], 0);
  assert.equal(leadInfo["Apps Approved"], 0);
  for (const excluded of ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS) assert.equal(Object.hasOwn(leadInfo, excluded), false);

  current["Next Task Tip"] = "A new approved tip.";
  current["Apps Submitted"] = 2;
  const updated = buildZohoLeadInfo(current, fields);
  assert.equal(updated["Next Task Tip"], "A new approved tip.");
  assert.equal(updated["Apps Submitted"], 2);
});

test("a missing supported snapshot field fails closed instead of becoming an implicit clear", () => {
  const incomplete = snapshot();
  delete incomplete["Next Task Tip"];
  assert.throws(() => buildZohoLeadInfo(incomplete, fields), /snapshot is missing: Next Task Tip/);
});

test("actual task descriptions and approved guide mappings drive task-specific guidance", () => {
  const kickoff = guidance("book-kickoff");
  assert.match(kickoff.tip, /^Schedule the kickoff meeting/);
  assert.equal(kickoff.guideUrl, null);

  const backup = guidance("add-backup-administrators");
  assert.match(backup.tip, /^Invite backup administrators/);
  assert.match(backup.guideUrl, /^https:\/\/partners\.kzero\.com\//);

  const employees = guidance("add-employees-and-contractors");
  assert.match(employees.tip, /^Invite the members of your team/);
  assert.match(employees.guideUrl, /^https:\/\/partners\.kzero\.com\//);

  const applications = guidance("submit-saas-applications-for-review");
  assert.match(applications.tip, /^Submit the SaaS applications/);
  assert.equal(applications.guideUrl, null);
});

test("actual progression selects fresh guidance for kickoff, setup, employee, and application transitions", () => {
  const next = (completed) => orderedTasks.find((item) => !completed.has(item.templateKey));
  assert.equal(next(new Set()).templateKey, "book-kickoff");
  assert.equal(next(new Set(["book-kickoff", "import-your-passwords"])).templateKey, "add-backup-administrators");
  assert.equal(next(new Set(["book-kickoff", "import-your-passwords", "add-backup-administrators"])).templateKey, "add-employees-and-contractors");
  assert.equal(next(new Set([
    "book-kickoff", "import-your-passwords", "add-backup-administrators",
    "add-employees-and-contractors", "share-vault-browser-extension-guidance"
  ])).templateKey, "submit-saas-applications-for-review");

  const backup = guidance("add-backup-administrators");
  const employees = guidance("add-employees-and-contractors");
  assert.notEqual(backup.tip, employees.tip);
  assert.notEqual(backup.guideUrl, employees.guideUrl);
});

test("missing task guidance stays unavailable and stale-sensitive journeys fail closed", () => {
  assert.deepEqual(getZohoTaskGuidance({ description: null, templateKey: "unknown-task" }), { guideUrl: null, tip: null });
  const current = snapshot();
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J1", current), []);
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J3_R1", current), ["Next Task Guide URL"]);
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J5", current), ["Next Task Guide URL"]);
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J8", current), []);
  assert.deepEqual(ZOHO_JOURNEY_FRESHNESS_FIELDS, {
    J1: [],
    J3_R1: ["Next Task Tip", "Next Task Guide URL"],
    J5: ["Next Task Tip", "Next Task Guide URL"],
    J8: []
  });
  assert.deepEqual(ZOHO_JOURNEY_GUIDANCE_EVIDENCE, {
    J1: {
      "Next Task Tip": "VERIFIED_NOT_USED",
      "Next Task Guide URL": "VERIFIED_NOT_USED"
    },
    J3_R1: { "Next Task Tip": "REQUIRED", "Next Task Guide URL": "REQUIRED" },
    J5: {
      "Next Task Tip": "REQUIRED",
      "Next Task Guide URL": "PARTIAL_REVIEW_NO_VISIBLE_REFERENCE"
    },
    J8: { "Next Task Tip": "VERIFIED_NOT_USED", "Next Task Guide URL": "VERIFIED_NOT_USED" }
  });
});

test("fresh optional guidance clears only the journey freshness hold", () => {
  const current = snapshot();
  current["Next Task Tip"] = "Use the current task link to continue.";
  current["Next Task Guide URL"] = "https://partners.kzero.com/approved-guide";
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J1", current), []);
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J3_R1", current), []);
  assert.deepEqual(getZohoJourneyFreshnessBlockers("J5", current), []);
});

test("snapshot link fields remain current KZero values rather than retained Zoho values", () => {
  const current = snapshot();
  assert.equal(current["Portal URL"], "https://portal.example.com/portal/test-nfr");
  assert.equal(
    current["Next Task Link"],
    "https://portal.example.com/portal/test-nfr?tab=tasks&task=book-kickoff"
  );
  assert.equal(current["SE Booking URL"], "https://booking.example.com/se");
  assert.equal(current["Next Task Guide URL"], null);
});

test("completed onboarding retains the final real task without inventing guidance", () => {
  const finalTask = task("complete-first-customer-rollout");
  const finalGuidance = guidance(finalTask.templateKey);
  const completed = snapshot({
    kickoffBookedAt: new Date("2026-11-21T00:00:00Z"),
    nextTask: {
      guideUrl: finalGuidance.guideUrl,
      minutes: null,
      owner: finalTask.owner,
      since: null,
      status: "complete",
      templateKey: finalTask.templateKey,
      tip: finalGuidance.tip,
      title: finalTask.title
    },
    plan: { currentStage: "First Customer Pilot", planId: "complete-nfr", progress: 100, status: "complete", tenantType: "nfr" }
  });
  assert.equal(completed["Current Phase"], "Onboarding Complete");
  assert.equal(completed["Onboarding State"], "Complete");
  assert.equal(completed["Next Task ID"], "complete-first-customer-rollout");
  assert.equal(completed["Next Task Status"], "Complete");
  assert.equal(completed["Next Task Guide URL"], null);
});

test("application-level provider failures remain failures even when HTTP transport succeeded", () => {
  assert.throws(() => parseSubscribeResult({ code: "2001", status: "error", message: "Invalid JSON" }), /Zoho/);
});

test("dispatcher checks stale-sensitive field freshness before any journey provider workflow", async () => {
  const source = await readFile(new URL("../lib/zoho-dispatcher.ts", import.meta.url), "utf8");
  assert.match(source, /getZohoJourneyFreshnessBlockers\(claim\.event\.journey, snapshot\.snapshot\)/);
  const freshnessCheck = source.indexOf("getZohoJourneyFreshnessBlockers(claim.event.journey, snapshot.snapshot)");
  const providerTrigger = source.indexOf("const result = await provider.triggerJourney", freshnessCheck);
  assert.ok(freshnessCheck >= 0 && providerTrigger > freshnessCheck);
});
