import { onboardingCases } from "@/lib/mock-data";
import {
  decryptOidcClientSecret,
  getMspWithOidcByLookupServer,
  getMspWithOidcByPlanIdServer,
  isDatabasePersistenceConfigured
} from "@/lib/msp-persistence";
import { normalizeTenantName } from "@/lib/tenant-routing";

export type ServerTenantOidcConfig = {
  clientId?: string;
  clientSecret?: string;
  mspName: string;
  mspSlug: string;
  planId: string;
  tenantName: string;
};

function getBaseUrl() {
  return process.env.KZERO_OIDC_BASE_URL?.trim() || "https://ca.auth.kzero.com";
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function getKzeroRedirectUri() {
  const configuredRedirectUri = process.env.KZERO_OIDC_REDIRECT_URI?.trim();

  if (configuredRedirectUri) {
    return configuredRedirectUri.replace(/\/+$/, "");
  }

  const authUrl = process.env.AUTH_URL?.trim() || "http://localhost:3000";
  return joinUrl(authUrl, "/api/oidc/callback");
}

function getClientIdEnvKey(mspSlug: string) {
  return `KZERO_OIDC_CLIENT_ID_${mspSlug.toUpperCase().replace(/-/g, "_")}`;
}

function getClientSecretEnvKey(mspSlug: string) {
  return `KZERO_OIDC_CLIENT_SECRET_${mspSlug.toUpperCase().replace(/-/g, "_")}`;
}

function buildServerOidcRegistry() {
  return onboardingCases
    .filter((item) => item.accessMode === "oidc" && item.tenantName)
    .map((item) => ({
      clientId: process.env[getClientIdEnvKey(item.mspSlug)]?.trim() || item.oidcClientId,
      clientSecret: process.env[getClientSecretEnvKey(item.mspSlug)]?.trim(),
      mspName: item.mspName,
      mspSlug: item.mspSlug,
      planId: item.onboardingPlanId,
      tenantName: item.tenantName as string
    }));
}

async function getDatabaseTenantOidcConfigByLookup(input: string) {
  if (!isDatabasePersistenceConfigured()) {
    return null;
  }

  const msp = await getMspWithOidcByLookupServer(input).catch(() => null);
  if (!msp?.oidcConfig) {
    return null;
  }

  const clientSecret = await decryptOidcClientSecret(msp.id).catch(() => null);
  if (!clientSecret) {
    return null;
  }

  return {
    clientId: msp.oidcConfig.clientId,
    clientSecret,
    mspName: msp.name,
    mspSlug: msp.slug,
    planId: msp.onboardingPlans[0]?.planId ?? `${msp.slug}-nfr`,
    tenantName: msp.oidcConfig.tenantRealm
  } satisfies ServerTenantOidcConfig;
}

async function getDatabaseTenantOidcConfigByPlanId(planId: string) {
  if (!isDatabasePersistenceConfigured()) {
    return null;
  }

  const msp = await getMspWithOidcByPlanIdServer(planId).catch(() => null);
  if (!msp?.oidcConfig) {
    return null;
  }

  const clientSecret = await decryptOidcClientSecret(msp.id).catch(() => null);
  if (!clientSecret) {
    return null;
  }

  return {
    clientId: msp.oidcConfig.clientId,
    clientSecret,
    mspName: msp.name,
    mspSlug: msp.slug,
    planId,
    tenantName: msp.oidcConfig.tenantRealm
  } satisfies ServerTenantOidcConfig;
}

function matchesLookup(config: ServerTenantOidcConfig, input: string) {
  const normalizedInput = normalizeTenantName(input);
  const candidates = [config.tenantName, config.mspName, config.mspSlug];
  return candidates.some((candidate) => normalizeTenantName(candidate) === normalizedInput);
}

export async function findServerTenantOidcConfigByInput(input?: string | null) {
  if (!input?.trim()) {
    return null;
  }

  if (isDatabasePersistenceConfigured()) {
    return getDatabaseTenantOidcConfigByLookup(input);
  }

  return buildServerOidcRegistry().find((config) => matchesLookup(config, input)) ?? null;
}

export async function findServerTenantOidcConfigByPlanId(planId?: string | null) {
  if (!planId?.trim()) {
    return null;
  }

  if (isDatabasePersistenceConfigured()) {
    return getDatabaseTenantOidcConfigByPlanId(planId);
  }

  return buildServerOidcRegistry().find((config) => config.planId === planId) ?? null;
}

export function buildKzeroIssuerFromConfig(config: Pick<ServerTenantOidcConfig, "tenantName">) {
  return joinUrl(getBaseUrl(), `/realms/${config.tenantName}`);
}

export function buildAuthorizationUrl(config: ServerTenantOidcConfig) {
  return `${buildKzeroIssuerFromConfig(config)}/protocol/openid-connect/auth`;
}

export function buildTokenUrl(config: ServerTenantOidcConfig) {
  return `${buildKzeroIssuerFromConfig(config)}/protocol/openid-connect/token`;
}

export function buildUserInfoUrl(config: ServerTenantOidcConfig) {
  return `${buildKzeroIssuerFromConfig(config)}/protocol/openid-connect/userinfo`;
}

export function buildLogoutUrl(config: ServerTenantOidcConfig) {
  return `${buildKzeroIssuerFromConfig(config)}/protocol/openid-connect/logout`;
}

// Production must load tenant OIDC configuration from an allowlisted server-side registry.
// Client secrets must be stored in encrypted storage or a secrets manager, never in mock data or browser storage.
