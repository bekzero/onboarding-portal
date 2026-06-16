export type TenantRegistryEntry = {
  displayName: string;
  planId: string;
  tenantSlug: string;
};

export const tenantRegistry: TenantRegistryEntry[] = [
  {
    displayName: "ABCMSP",
    planId: "abcmsp-nfr",
    tenantSlug: "abcmsp"
  },
  {
    displayName: "Northwind MSP",
    planId: "northwind-nfr",
    tenantSlug: "northwind"
  }
];

export function normalizeTenantName(input?: string | null) {
  if (!input) {
    return "";
  }

  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findTenantByInput(input?: string | null) {
  const normalizedInput = normalizeTenantName(input);

  if (!normalizedInput) {
    return null;
  }

  return (
    tenantRegistry.find((entry) => normalizeTenantName(entry.tenantSlug) === normalizedInput) ?? null
  );
}

export function getDemoPlanUrlForTenant(input?: string | null) {
  const tenant = findTenantByInput(input);

  if (!tenant) {
    return null;
  }

  return `/demo/${tenant.planId}`;
}

export function buildKzeroIssuerForTenant(tenantSlug: string) {
  const normalizedTenant = normalizeTenantName(tenantSlug);

  if (!normalizedTenant) {
    return null;
  }

  // Production OIDC should never trust arbitrary tenant input directly.
  // Only allowlisted tenant registry entries should be used to construct live OIDC endpoints.
  return `https://ca.auth.kzero.com/realms/${normalizedTenant}`;
}

export function resolvePlanIdFromTenantClaim(tenantClaim?: string | null) {
  return findTenantByInput(tenantClaim)?.planId ?? null;
}

export function resolvePortalPathFromTenantClaim(tenantClaim?: string | null) {
  const planId = resolvePlanIdFromTenantClaim(tenantClaim);

  if (!planId) {
    return null;
  }

  // Future production flow:
  // 1. Discover the tenant from authenticated KZero OIDC tenant/org claims.
  // 2. Map the allowlisted tenant to a plan id.
  // 3. Redirect to /portal/resolve or directly to the resolved /portal/<planId> route.
  return `/portal/${planId}`;
}

// KZero OIDC endpoint pattern for future tenant-aware login:
// Issuer: https://ca.auth.kzero.com/realms/<TENANT_NAME>
// Discovery: https://ca.auth.kzero.com/realms/<TENANT_NAME>/.well-known/openid-configuration
// Authorization: https://ca.auth.kzero.com/realms/<TENANT_NAME>/protocol/openid-connect/auth
// Token: https://ca.auth.kzero.com/realms/<TENANT_NAME>/protocol/openid-connect/token
// UserInfo: https://ca.auth.kzero.com/realms/<TENANT_NAME>/protocol/openid-connect/userinfo
// Logout: https://ca.auth.kzero.com/realms/<TENANT_NAME>/protocol/openid-connect/logout
// Real sign-in will later redirect to:
// /api/auth/signin/keycloak?callbackUrl=/portal/resolve
// or to a future dynamic tenant-aware OIDC start route.
