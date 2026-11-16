import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyZohoTestContactCheck,
  executeControlledTestContactSync
} from "../lib/zoho-test-contact-core.ts";

const accepted = {
  acceptedCount: 1,
  batchCount: 1,
  errorCount: 0,
  existingCount: 0,
  ignoredCount: 0,
  results: [{ classification: "ACCEPTED", email: "test@kzero.com", providerCode: "0", reason: "PROVIDER_ACCEPTED" }]
};

test("contact checks distinguish existing, absent, and incomplete scans", () => {
  assert.equal(classifyZohoTestContactCheck({ complete: true, listStatuses: ["active"] }).classification, "EXISTING");
  assert.equal(classifyZohoTestContactCheck({ complete: true, listStatuses: [] }).classification, "NOT_FOUND");
  assert.equal(classifyZohoTestContactCheck({ complete: false, listStatuses: [] }).classification, "UNABLE_TO_VERIFY");
  assert.equal(classifyZohoTestContactCheck({ complete: false, listStatuses: ["unsub"] }).classification, "EXISTING");
});

test("existing contacts and suppressed contacts never invoke the write adapter", async () => {
  let writes = 0;
  const existing = await executeControlledTestContactSync({
    add: async () => { writes += 1; return accepted; },
    check: async () => ({ complete: true, listStatuses: ["active"] })
  });
  assert.equal(existing.classification, "EXISTING");
  const suppressed = await executeControlledTestContactSync({
    add: async () => { writes += 1; return accepted; },
    check: async () => ({ complete: true, listStatuses: ["bounce"] })
  });
  assert.equal(suppressed.classification, "IGNORED");
  assert.equal(writes, 0);
});

test("accepted writes become VERIFIED only after getleads finds active membership", async () => {
  const checks = [
    { complete: true, listStatuses: [] },
    { complete: true, listStatuses: ["active"] }
  ];
  const result = await executeControlledTestContactSync({
    add: async () => accepted,
    check: async () => checks.shift()
  });
  assert.deepEqual(result, { classification: "VERIFIED", reason: "ACTIVE_MEMBERSHIP_VERIFIED" });
});

test("accepted but not visible contacts remain pending verification", async () => {
  const result = await executeControlledTestContactSync({
    add: async () => accepted,
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(result.classification, "PENDING_VERIFICATION");
  assert.equal(result.reason, "ACCEPTED_NOT_YET_VISIBLE");
});

test("incomplete scans and provider failures fail closed", async () => {
  let writes = 0;
  const incomplete = await executeControlledTestContactSync({
    add: async () => { writes += 1; return accepted; },
    check: async () => ({ complete: false, listStatuses: [] })
  });
  assert.equal(incomplete.classification, "FAILED");
  assert.equal(writes, 0);

  const failed = await executeControlledTestContactSync({
    add: async () => { throw new Error("provider failure"); },
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(failed.classification, "FAILED");
});

test("provider ignored outcomes remain distinct from acceptance", async () => {
  const result = await executeControlledTestContactSync({
    add: async () => ({ ...accepted, acceptedCount: 0, ignoredCount: 1, results: [{ classification: "IGNORED", email: "test@kzero.com", providerCode: "0", reason: "PROVIDER_IGNORED" }] }),
    check: async () => ({ complete: true, listStatuses: [] })
  });
  assert.equal(result.classification, "IGNORED");
});

test("admin routes enforce read and sensitive write authorization", async () => {
  const checkRoute = await readFile(new URL("../app/api/admin/zoho/test-contact/check/route.ts", import.meta.url), "utf8");
  const syncRoute = await readFile(new URL("../app/api/admin/zoho/test-contact/sync/route.ts", import.meta.url), "utf8");
  assert.match(checkRoute, /getAdminApiAuthError\("SALES_ENGINEER"\)/);
  assert.match(syncRoute, /getAdminApiAuthError\("ADMIN"\)/);
  assert.match(syncRoute, /getSensitiveAdminApiAuthError\(request\)/);
  assert.match(syncRoute, /getSensitiveAdminAuditActor/);
});

test("test writes require allowlisting, explicit flags, kill-switch release, and durable request IDs", async () => {
  const service = await readFile(new URL("../lib/zoho-test-contact.ts", import.meta.url), "utf8");
  const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(service, /SYNC ALLOWLISTED TEST CONTACT/);
  assert.match(service, /allowedEmails\.has\(normalizedEmail\)/);
  assert.match(service, /globalKillSwitch/);
  assert.match(service, /zoho\.test_contact_sync\.requested/);
  assert.match(service, /P2002/);
  assert.match(env, /ZOHO_TEST_CONTACT_SYNC_ENABLED=false/);
});

test("Admin Center exposes no ListKey and accurately labels email-only synchronization", async () => {
  const ui = await readFile(new URL("../components/zoho-automation-center.tsx", import.meta.url), "utf8");
  assert.match(ui, /Test Contact Sync/);
  assert.match(ui, /only the email address|email-only/i);
  assert.match(ui, /Check Contact/);
  assert.match(ui, /Sync Test Contact/);
  assert.match(ui, /Already Exists/);
  assert.match(ui, /Unable to Verify/);
  assert.doesNotMatch(ui, /ZMA_LIST_KEY|ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN/);
});
