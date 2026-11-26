import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

const state = { audits: [], writes: 0, authorizationError: null };
const transaction = {
  msp: {
    async create({ data }) {
      state.writes++;
      if (state.persistenceError) throw state.persistenceError;
      const { onboardingPlans, ...msp } = data;
      const { planContacts, onboardingTasks, ...plan } = onboardingPlans.create;
      state.plan = {
        ...plan, id: "fixture-plan",
        onboardingTasks: onboardingTasks?.create ?? [],
        planContacts: [{ ...planContacts.create, id: "fixture-contact" }]
      };
      return { ...msp, id: "fixture-msp", onboardingPlans: [state.plan] };
    }
  },
  onboardingPlan: { findUnique: async () => state.plan },
  zohoCommunicationContext: { findUnique: async () => null },
  zohoAutomationAudit: { create: async ({ data }) => state.audits.push(data) }
};
globalThis.enrollmentTest = { state, prisma: { $transaction: (work) => work(transaction) } };

const mocks = {
  "server-only": "export default {};",
  "@/lib/prisma": "export const { prisma } = globalThis.enrollmentTest;",
  "@/lib/admin-auth": `
    export const getAdminApiAuthError = async () => null;
    export const getAdminAuditActor = () => "shared";
    export const getCurrentStaffIdentity = async () => ({ sub: "admin", role: "ADMIN" });
    export const getSensitiveAdminApiAuthError = async (_request, role) => {
      if (role !== "ADMIN") throw new Error("ADMIN authorization was not requested");
      return globalThis.enrollmentTest.state.authorizationError;
    };
  `,
  "@/lib/staff-auth": 'export const formatStaffAuditActor = () => "oidc:fixture-admin";'
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mocks, specifier)) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}` };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  }
});

for (const key of Object.keys(process.env)) {
  if (/^(ZOHO_|ZMA_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused@127.0.0.1/unused",
  VERCEL_ENV: "production",
  ZOHO_DISPATCH_MODE: "disabled",
  ZOHO_GLOBAL_KILL_SWITCH: "true"
});
const { POST } = await import("../app/api/admin/msps/route.ts");
const payload = {
  accessMode: "temporary",
  name: "Dormant Enrollment Fixture",
  primaryContactEmail: "owner@example.test"
};
const submit = (body) => POST(new Request("https://portal.example.test/api/admin/msps", {
  method: "POST", body: JSON.stringify(body)
}));

test("ordinary enrollment persists permission and subscription evidence while Zoho is dormant", async () => {
  const response = await submit({
    ...payload,
    zohoContactPermission: { confirmed: true, evidenceReference: "Permission ticket 123" },
    zohoSubscriptionAuthorization: {
      confirmed: true, evidenceReference: "Consent ticket 123",
      authorizationBasis: "The owner expressly authorized onboarding email."
    },
    zohoTestJ1Preparation: { confirmed: false }
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).msp.automationEnrollmentState, "PENDING");
  assert.equal(state.plan.automaticJ1Allowed, false);
  assert.equal(state.plan.planContacts[0].automationEnabled, false);
  assert.equal(state.plan.planContacts[0].subscriptionStatus, "CONFIRMED");
  assert.deepEqual(state.audits.map(({ action, actor }) => [action, actor]), [
    ["msp_enrollment.subscription_authorization_recorded", "oidc:fixture-admin"],
    ["msp_enrollment.contact_permission_recorded", "oidc:fixture-admin"],
    ["msp_enrollment.contact_sync_skipped", "oidc:fixture-admin"]
  ]);
});

test("ordinary enrollment also succeeds without Zoho authorization evidence", async () => {
  const response = await submit(payload);
  assert.equal(response.status, 201);
  assert.equal(state.plan.automationEnrollmentState, "PENDING");
  assert.equal(state.plan.planContacts[0].subscriptionStatus, "UNKNOWN");
  assert.equal(state.plan.planContacts[0].automationEnabled, false);
});

test("stale TEST J1 selections and invalid evidence return safe codes before persistence", async () => {
  const writes = state.writes;
  for (const [extra, code] of [
    [{ zohoTestJ1Preparation: { confirmed: true } }, "LEGACY_TEST_J1_NOT_SUPPORTED"],
    [{ zohoTestJ1Preparation: { productionJourneyReuseConfirmed: true } }, "LEGACY_TEST_J1_NOT_SUPPORTED"],
    [{ zohoContactPermission: { confirmed: true } }, "PERMISSION_EVIDENCE_REQUIRED"],
    [{ zohoSubscriptionAuthorization: { confirmed: true } }, "INVALID_SUBSCRIPTION_AUTHORIZATION"]
  ]) {
    const response = await submit({ ...payload, ...extra });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.code, code);
    assert.match(result.requestId, /^[0-9a-f-]{36}$/);
    assert.ok(result.error);
  }
  assert.equal(state.writes, writes);
});

test("subscription confirmation still requires individual ADMIN authorization", async () => {
  const writes = state.writes;
  state.authorizationError = Response.json({ code: "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED" }, { status: 403 });
  try {
    const response = await submit({ ...payload, zohoSubscriptionAuthorization: { confirmed: true } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED");
    assert.equal(state.writes, writes);
  } finally {
    state.authorizationError = null;
  }
});

test("unexpected persistence errors never expose internal details", async () => {
  state.persistenceError = new Error("Internal fixture error that must not reach the browser");
  try {
    const response = await submit(payload);
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(result.code, "MSP_ENROLLMENT_FAILED");
    assert.doesNotMatch(result.error, /internal fixture error/i);
  } finally {
    state.persistenceError = null;
  }
});

test("the enrollment form omits legacy options and displays the POST error inline", async () => {
  const dashboard = await readFile(new URL("../components/internal-dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /prepareZohoTestJ1|zohoTestJ1Preparation|productionJ1ReviewEvidence/);
  assert.match(dashboard, /const failure = await createResponse\.json\(\)/);
  assert.match(dashboard, /setEnrollmentErrorMessage\([\s\S]*?failure\.requestId/);
});
