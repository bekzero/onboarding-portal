import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expectedIssuerForRealm, validateStaffSsoInput } from "../lib/staff-sso-validation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const valid = (overrides = {}) => ({ realmName: "KZeroStaff", clientId: "staff-portal", clientSecret: "secret", issuerUrl: "https://ca.auth.kzero.com/realms/KZeroStaff", applicationOrigin: "https://admin.kzero.example", postLogoutRedirectUri: "https://admin.kzero.example/admin-login", ...overrides });

test("issuer and callback are deterministic and realm casing is enforced", () => {
  assert.equal(expectedIssuerForRealm("KZeroStaff"), "https://ca.auth.kzero.com/realms/KZeroStaff");
  assert.equal(validateStaffSsoInput(valid()).redirectUri, "https://admin.kzero.example/api/auth/callback/kzero-staff");
  assert.throws(() => validateStaffSsoInput(valid({ issuerUrl: "https://ca.auth.kzero.com/realms/kzerostaff" })), /case-sensitive/);
});

test("untrusted discovery hosts, HTTP origins, and off-origin logout redirects fail closed", () => {
  assert.throws(() => validateStaffSsoInput(valid({ issuerUrl: "https://evil.example/realms/KZeroStaff" })), /Issuer must exactly match/);
  assert.throws(() => validateStaffSsoInput(valid({ applicationOrigin: "http://admin.kzero.example" })), /HTTPS/);
  assert.throws(() => validateStaffSsoInput(valid({ postLogoutRedirectUri: "https://evil.example/logout" })), /remain on/);
  assert.throws(() => validateStaffSsoInput(valid({ clientId: "" })), /Client ID/);
});

test("stored secrets are encrypted, masked, and never serialized", async () => {
  const config = await read("lib/staff-sso-config.ts");
  const ui = await read("components/staff-sso-settings.tsx");
  assert.match(config, /encryptOidcClientSecret/);
  assert.match(config, /decryptStoredOidcClientSecret/);
  assert.match(ui, /Stored securely ••••••••/);
  assert.doesNotMatch(config.match(/serializeStaffSsoConfiguration[\s\S]+$/)?.[0] || "", /encryptedClientSecret\s*:|secretAuthTag\s*:|secretIv\s*:/);
});

test("bootstrap and settings writes require layered, same-origin authorization", async () => {
  const bootstrap = await read("lib/staff-sso-bootstrap.ts");
  const admin = await read("lib/staff-sso-admin.ts");
  const route = await read("app/api/admin/settings/sso/route.ts");
  assert.match(bootstrap, /httpOnly: true/); assert.match(bootstrap, /sameSite: "strict"/); assert.match(bootstrap, /15 \* 60/);
  assert.match(admin, /hasAdminSession/); assert.match(admin, /hasStaffSsoBootstrapAuthorization/); assert.match(admin, /getAuthorizedStaffIdentity\("ADMIN"\)/); assert.match(admin, /isTrustedSameOriginRequest/);
  assert.match(route, /getStaffSsoSettingsActor/);
});

test("activation requires discovery, real authentication, a verified ADMIN, and recovery", async () => {
  const admin = await read("lib/staff-sso-admin.ts");
  assert.match(admin, /discoveryValidatedAt/); assert.match(admin, /authenticationTestedAt/); assert.match(admin, /verifiedAt: \{ not: null \}/); assert.match(admin, /ADMIN_ACCESS_CODE/); assert.match(admin, /bootstrapRetiredAt/);
});

test("Auth.js uses authorization code safeguards and database identity roles without exposing tokens", async () => {
  const auth = await read("auth.ts");
  assert.match(auth, /checks: \["pkce", "state", "nonce"\]/); assert.match(auth, /findApprovedStaffIdentity/); assert.match(auth, /staff_test_only/);
  assert.doesNotMatch(auth, /session\.user[\s\S]*access_token/);
});

test("last active administrator is protected and shared access does not become an individual identity", async () => {
  const config = await read("lib/staff-sso-config.ts"); const auth = await read("lib/admin-auth.ts");
  assert.match(config, /last active approved administrator cannot be removed/); assert.match(auth, /INDIVIDUAL_ADMIN_IDENTITY_REQUIRED/);
  assert.doesNotMatch(config, /endsWith\([^)]*@kzero\.com/i);
});
