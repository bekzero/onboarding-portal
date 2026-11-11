export const STAFF_OIDC_PROVIDER_ID = "kzero-staff";
export const STAFF_OIDC_CALLBACK_PATH = `/api/auth/callback/${STAFF_OIDC_PROVIDER_ID}`;
const TRUSTED_HOST = "ca.auth.kzero.com";

export type StaffSsoInput = {
  realmName: string; clientId: string; clientSecret?: string; issuerUrl: string; applicationOrigin: string; postLogoutRedirectUri: string;
  adminRoleClaim?: string; salesEngineerRoleClaim?: string; viewerRoleClaim?: string; approvedGroupClaim?: string;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const expectedIssuerForRealm = (realmName: string) => `https://${TRUSTED_HOST}/realms/${realmName}`;

export function validateStaffSsoInput(raw: StaffSsoInput) {
  const realmName = clean(raw.realmName);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(realmName)) throw new Error("Realm name is required and may contain only letters, numbers, dots, underscores, and hyphens. Realm casing is preserved.");
  const clientId = clean(raw.clientId); if (!clientId) throw new Error("Client ID is required.");
  const expectedIssuer = expectedIssuerForRealm(realmName); const issuerUrl = clean(raw.issuerUrl).replace(/\/$/, "");
  if (issuerUrl !== expectedIssuer) throw new Error(`Issuer must exactly match ${expectedIssuer}. Realm names are case-sensitive.`);
  const applicationOrigin = new URL(clean(raw.applicationOrigin));
  if (applicationOrigin.protocol !== "https:" && applicationOrigin.hostname !== "localhost") throw new Error("Application origin must use HTTPS (localhost is allowed for development). ");
  if (applicationOrigin.pathname !== "/" || applicationOrigin.search || applicationOrigin.hash) throw new Error("Application origin must contain only scheme, host, and optional port.");
  const postLogout = new URL(clean(raw.postLogoutRedirectUri), applicationOrigin.origin);
  if (postLogout.origin !== applicationOrigin.origin) throw new Error("Post-logout redirect must remain on the configured application origin.");
  return { realmName, clientId, clientSecret: clean(raw.clientSecret), issuerUrl, applicationOrigin: applicationOrigin.origin, redirectUri: `${applicationOrigin.origin}${STAFF_OIDC_CALLBACK_PATH}`, postLogoutRedirectUri: postLogout.toString(), adminRoleClaim: clean(raw.adminRoleClaim) || null, salesEngineerRoleClaim: clean(raw.salesEngineerRoleClaim) || null, viewerRoleClaim: clean(raw.viewerRoleClaim) || null, approvedGroupClaim: clean(raw.approvedGroupClaim) || null };
}
