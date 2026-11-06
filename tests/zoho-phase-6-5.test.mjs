import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  authorizeStaffIdentity,
  extractTrustedStaffRoles,
  staffRoleAllows
} from "../lib/staff-authorization-core.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const policy = (overrides = {}) => ({
  trustedIssuer: "https://staff.example.test/realms/kzero",
  adminRole: "portal-admin",
  salesEngineerRole: "portal-se",
  viewerRole: "portal-viewer",
  allowedSubjects: new Set(),
  ...overrides
});
const identity = (roles, overrides = {}) => ({
  issuer: "https://staff.example.test/realms/kzero",
  subject: "employee-123",
  email: "employee@example.test",
  emailVerified: true,
  claims: { roles },
  ...overrides
});

test("valid signed-claim roles resolve to ADMIN, SALES_ENGINEER, and VIEWER", () => {
  assert.equal(authorizeStaffIdentity(identity(["portal-admin"]), policy()).role, "ADMIN");
  assert.equal(authorizeStaffIdentity(identity(["portal-se"]), policy()).role, "SALES_ENGINEER");
  assert.equal(authorizeStaffIdentity(identity(["portal-viewer"]), policy()).role, "VIEWER");
  assert.equal(staffRoleAllows("ADMIN", "VIEWER"), true);
  assert.equal(staffRoleAllows("VIEWER", "SALES_ENGINEER"), false);
});

test("unknown identities, untrusted issuers, and absent application roles fail closed", () => {
  assert.equal(authorizeStaffIdentity(identity(["portal-admin"], { issuer: "https://customer.example.test" }), policy()).reason, "UNTRUSTED_ISSUER");
  assert.equal(authorizeStaffIdentity(identity([]), policy()).reason, "APP_ROLE_REQUIRED");
  assert.equal(authorizeStaffIdentity(identity(["portal-admin"]), policy({ allowedSubjects: new Set(["other-subject"]) })).reason, "SUBJECT_NOT_ALLOWLISTED");
  assert.equal(authorizeStaffIdentity(identity(["portal-admin"], { subject: "" }), policy()).reason, "MISSING_SUBJECT");
});

test("resource role parsing can be constrained to the staff client", () => {
  const claims = {
    realm_access: { roles: ["realm-role"] },
    resource_access: {
      "staff-client": { roles: ["portal-admin"] },
      "unrelated-client": { roles: ["forged-unrelated-role"] }
    }
  };
  const roles = extractTrustedStaffRoles(claims, "staff-client");
  assert.deepEqual(new Set(roles), new Set(["realm-role", "portal-admin"]));
  assert.equal(roles.includes("forged-unrelated-role"), false);
});

test("Auth.js staff provider requires dedicated configuration and protocol checks", async () => {
  const auth = await read("auth.ts");
  assert.match(auth, /id: "kzero-staff"/);
  assert.match(auth, /STAFF_AUTH_ISSUER/);
  assert.match(auth, /checks: \["pkce", "state", "nonce"\]/);
  assert.match(auth, /clientId: process\.env\.STAFF_AUTH_CLIENT_ID/);
  assert.match(auth, /session: \{ strategy: "jwt", maxAge: 60 \* 60 \* 8/);
  assert.match(auth, /authorizeStaffIdentity/);
  assert.doesNotMatch(auth, /@kzero\.com.*ADMIN|endsWith\(.*kzero/i);
});

test("staff access tokens and secrets are not copied into browser sessions", async () => {
  const auth = await read("auth.ts");
  const types = await read("types/next-auth.d.ts");
  assert.doesNotMatch(auth, /session\.user[\s\S]*access_token/);
  assert.doesNotMatch(types, /access_token|refresh_token|client_secret/);
  assert.match(types, /staff_subject/);
  assert.match(types, /staff_roles/);
});

test("shared access remains compatible but cannot satisfy sensitive authorization", async () => {
  const adminAuth = await read("lib/admin-auth.ts");
  assert.match(adminAuth, /if \(await hasAdminSession\(\)\)/);
  assert.match(adminAuth, /requiredRole === "ADMIN"/);
  assert.match(adminAuth, /getSensitiveAdminApiAuthError/);
  assert.match(adminAuth, /const identity = await getAuthenticatedStaffIdentity\(\)/);
  assert.doesNotMatch(adminAuth, /getSensitiveAdminApiAuthError[\s\S]{0,500}hasAdminSession/);
});

test("sensitive Zoho actions require ADMIN, same-origin checks, and attributable audit actors", async () => {
  const adminAuth = await read("lib/admin-auth.ts");
  assert.match(adminAuth, /isTrustedSameOriginRequest/);
  assert.match(adminAuth, /formatStaffAuditActor/);
  for (const path of [
    "app/api/admin/zoho/verify-subscription/route.ts",
    "app/api/admin/zoho/dispatch/[eventId]/reconcile/route.ts",
    "app/api/admin/zoho/test-sync/route.ts",
    "app/api/admin/zoho/test-fixture/route.ts",
    "app/api/admin/zoho/dispatch/route.ts"
  ]) {
    const route = await read(path);
    assert.match(route, /getSensitiveAdminApiAuthError\(request\)/);
  }
  assert.match(await read("app/api/admin/zoho/verify-subscription/route.ts"), /getSensitiveAdminAuditActor/);
  assert.match(await read("app/api/admin/zoho/dispatch/[eventId]/reconcile/route.ts"), /getSensitiveAdminAuditActor/);
});

test("viewer and sales-engineer staff mutations are server-role constrained", async () => {
  assert.match(await read("app/api/admin/msps/route.ts"), /POST[\s\S]*getAdminApiAuthError\("SALES_ENGINEER"\)/);
  assert.match(await read("app/api/admin/msps/[mspId]/route.ts"), /DELETE[\s\S]*getAdminApiAuthError\("ADMIN"\)/);
  assert.match(await read("app/api/admin/msps/[mspId]/complete-kzero-step/route.ts"), /getAdminApiAuthError\("SALES_ENGINEER"\)/);
});

test("staff UI provides branded sign-in, identity, role, logout, and top-level embedded fallback", async () => {
  const login = await read("app/admin/staff-login/page.tsx");
  const identityControl = await read("components/staff-identity-control.tsx");
  const unavailable = await read("components/admin-session-unavailable.tsx");
  assert.match(login, /KzeroLogo/);
  assert.match(login, /ThemeToggle/);
  assert.match(login, /approved KZero employee identity/);
  assert.match(identityControl, /identity\.role/);
  assert.match(identityControl, /signOutStaff/);
  assert.match(unavailable, /target="_blank"/);
  assert.match(unavailable, /third-party cookies/);
});

test("configuration is fail-closed and does not assume a staff realm", async () => {
  const env = await read(".env.example");
  for (const key of ["STAFF_AUTH_ISSUER=", "STAFF_AUTH_CLIENT_ID=", "STAFF_AUTH_CLIENT_SECRET=", "STAFF_AUTH_ADMIN_ROLE="]) assert.match(env, new RegExp(key));
  assert.doesNotMatch(env, /STAFF_AUTH_ISSUER=https:/);
  assert.match(env, /must not point at an MSP or customer tenant realm/);
});
