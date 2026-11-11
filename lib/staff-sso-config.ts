import "server-only";

import { StaffApplicationRole, StaffSsoStatus } from "@prisma/client";
import { decryptStoredOidcClientSecret, encryptOidcClientSecret } from "@/lib/oidc-secret-crypto";
import { prisma } from "@/lib/prisma";
import { STAFF_OIDC_CALLBACK_PATH, STAFF_OIDC_PROVIDER_ID, expectedIssuerForRealm, validateStaffSsoInput, type StaffSsoInput } from "@/lib/staff-sso-validation";

export { STAFF_OIDC_CALLBACK_PATH, STAFF_OIDC_PROVIDER_ID, expectedIssuerForRealm, validateStaffSsoInput } from "@/lib/staff-sso-validation";
export type { StaffSsoInput } from "@/lib/staff-sso-validation";

export const STAFF_SSO_CONFIGURATION_ID = "primary";
function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function getStoredStaffSsoConfiguration() {
  return prisma.staffSsoConfiguration.findUnique({ where: { id: STAFF_SSO_CONFIGURATION_ID }, include: { identities: { orderBy: [{ role: "asc" }, { email: "asc" }] } } });
}

export async function getStaffSsoRuntimeConfiguration() {
  const config = await prisma.staffSsoConfiguration.findUnique({ where: { id: STAFF_SSO_CONFIGURATION_ID } }).catch(() => null);
  if (config) {
    let clientSecret = "";
    try { clientSecret = decryptStoredOidcClientSecret(config, "STAFF_SSO_ENCRYPTION_KEY"); } catch { clientSecret = ""; }
    return {
    source: "database" as const,
    enabled: config.status === StaffSsoStatus.ENABLED,
    testable: Boolean(config.clientId && clientSecret),
    issuer: config.issuerUrl,
    clientId: config.clientId,
    clientSecret,
    status: config.status,
    adminRole: config.adminRoleClaim || "",
    salesEngineerRole: config.salesEngineerRoleClaim || "",
    viewerRole: config.viewerRoleClaim || "",
    approvedGroupClaim: config.approvedGroupClaim || ""
  };
  }
  const issuer = process.env.STAFF_AUTH_ISSUER?.trim().replace(/\/$/, "") || "";
  const clientId = process.env.STAFF_AUTH_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.STAFF_AUTH_CLIENT_SECRET?.trim() || "";
  return {
    source: "environment" as const,
    enabled: Boolean(issuer && clientId && clientSecret),
    testable: Boolean(issuer && clientId && clientSecret),
    issuer,
    clientId,
    clientSecret,
    status: issuer && clientId && clientSecret ? StaffSsoStatus.ENABLED : StaffSsoStatus.DISABLED,
    adminRole: process.env.STAFF_AUTH_ADMIN_ROLE?.trim() || "",
    salesEngineerRole: process.env.STAFF_AUTH_SALES_ENGINEER_ROLE?.trim() || "",
    viewerRole: process.env.STAFF_AUTH_VIEWER_ROLE?.trim() || "",
    approvedGroupClaim: ""
  };
}

export async function saveStaffSsoDraft(input: StaffSsoInput, actor: string) {
  const parsed = validateStaffSsoInput(input);
  const existing = await prisma.staffSsoConfiguration.findUnique({ where: { id: STAFF_SSO_CONFIGURATION_ID } });
  if (!existing && !parsed.clientSecret) throw new Error("Client secret is required when creating the configuration.");
  const encrypted = parsed.clientSecret ? encryptOidcClientSecret(parsed.clientSecret, "STAFF_SSO_ENCRYPTION_KEY") : {
    encryptedClientSecret: existing!.encryptedClientSecret,
    secretAuthTag: existing!.secretAuthTag,
    secretIv: existing!.secretIv
  };
  const { clientSecret: _discardedSecret, ...safeFields } = parsed;
  return prisma.$transaction(async (tx) => {
    const config = await tx.staffSsoConfiguration.upsert({
      where: { id: STAFF_SSO_CONFIGURATION_ID },
      create: { id: STAFF_SSO_CONFIGURATION_ID, ...safeFields, ...encrypted, status: StaffSsoStatus.DRAFT },
      update: { ...safeFields, ...encrypted, status: StaffSsoStatus.DRAFT, discoveryValidatedAt: null, discoveryEvidence: undefined, authenticationTestedAt: null, authenticationSubject: null }
    });
    await tx.staffSsoAudit.create({ data: { configurationId: config.id, actor, action: parsed.clientSecret ? "CONFIGURATION_SAVED_SECRET_REPLACED" : "CONFIGURATION_SAVED", reason: "Staff SSO draft updated." } });
    return config;
  });
}

export async function listStaffIdentities() {
  return prisma.staffIdentity.findMany({ where: { configurationId: STAFF_SSO_CONFIGURATION_ID }, orderBy: [{ role: "asc" }, { email: "asc" }] });
}

export async function findApprovedStaffIdentity(issuer: string, subject: string) {
  return prisma.staffIdentity.findUnique({ where: { issuer_subject: { issuer: issuer.replace(/\/$/, ""), subject } } });
}

export async function upsertStaffIdentity(input: { issuer: string; subject: string; email?: string | null; displayName?: string | null; role: StaffApplicationRole; active?: boolean }, actor: string) {
  const config = await prisma.staffSsoConfiguration.findUniqueOrThrow({ where: { id: STAFF_SSO_CONFIGURATION_ID } });
  if (input.issuer.replace(/\/$/, "") !== config.issuerUrl || !input.subject.trim()) throw new Error("Identity issuer and subject must match the configured provider.");
  return prisma.$transaction(async (tx) => {
    const identity = await tx.staffIdentity.upsert({
      where: { issuer_subject: { issuer: config.issuerUrl, subject: input.subject.trim() } },
      create: { configurationId: config.id, issuer: config.issuerUrl, subject: input.subject.trim(), email: clean(input.email) || null, displayName: clean(input.displayName) || null, role: input.role, active: input.active ?? true },
      update: { email: clean(input.email) || null, displayName: clean(input.displayName) || null, role: input.role, active: input.active ?? true }
    });
    await tx.staffSsoAudit.create({ data: { configurationId: config.id, actor, action: "STAFF_IDENTITY_UPDATED", targetSubject: identity.subject, reason: `Staff access set to ${identity.role}.` } });
    return identity;
  });
}

export async function removeStaffIdentity(id: string, actor: string) {
  return prisma.$transaction(async (tx) => {
    const identity = await tx.staffIdentity.findUniqueOrThrow({ where: { id } });
    if (identity.role === StaffApplicationRole.ADMIN && identity.active) {
      const count = await tx.staffIdentity.count({ where: { configurationId: identity.configurationId, role: StaffApplicationRole.ADMIN, active: true } });
      if (count <= 1) throw new Error("The last active approved administrator cannot be removed.");
    }
    await tx.staffIdentity.delete({ where: { id } });
    await tx.staffSsoAudit.create({ data: { configurationId: identity.configurationId, actor, action: "STAFF_IDENTITY_REMOVED", targetSubject: identity.subject, reason: "Staff access removed." } });
  });
}

export function serializeStaffSsoConfiguration(config: Awaited<ReturnType<typeof getStoredStaffSsoConfiguration>>) {
  if (!config) return null;
  return {
    id: config.id, realmName: config.realmName, clientId: config.clientId, issuerUrl: config.issuerUrl,
    applicationOrigin: config.applicationOrigin, redirectUri: config.redirectUri, postLogoutRedirectUri: config.postLogoutRedirectUri,
    adminRoleClaim: config.adminRoleClaim, salesEngineerRoleClaim: config.salesEngineerRoleClaim, viewerRoleClaim: config.viewerRoleClaim,
    approvedGroupClaim: config.approvedGroupClaim, status: config.status, secretConfigured: Boolean(config.encryptedClientSecret),
    discoveryValidatedAt: config.discoveryValidatedAt?.toISOString() ?? null, authenticationTestedAt: config.authenticationTestedAt?.toISOString() ?? null,
    enabledAt: config.enabledAt?.toISOString() ?? null, bootstrapRetiredAt: config.bootstrapRetiredAt?.toISOString() ?? null,
    identities: config.identities.map(({ id, issuer, subject, email, displayName, role, active, verifiedAt, lastAuthenticatedAt }) => ({ id, issuer, subject, email, displayName, role, active, verifiedAt: verifiedAt?.toISOString() ?? null, lastAuthenticatedAt: lastAuthenticatedAt?.toISOString() ?? null }))
  };
}
