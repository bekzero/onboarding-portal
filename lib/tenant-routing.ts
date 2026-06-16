export type TenantRegistryEntry = {
  accessMode: "temporary" | "oidc";
  displayName: string;
  mspSlug: string;
  oidcStatus: "not_configured" | "configured";
  planId: string;
  primaryContactEmail: string;
  tenantSlug: string;
};

export type DemoEnrollment = {
  assignedSalesEngineer: string;
  accessMode: "temporary" | "oidc";
  enrolledAt: string;
  mspName: string;
  mspSlug: string;
  oidcClientId?: string;
  oidcClientSecretConfigured: boolean;
  oidcStatus: "not_configured" | "configured";
  planId: string;
  primaryContactEmail: string;
  startingPlanType: "nfr" | "customer";
  tenantName?: string;
};

export const DEMO_ENROLLMENTS_STORAGE_KEY = "kzero-demo-enrollments";

export const tenantRegistry: TenantRegistryEntry[] = [
  {
    accessMode: "oidc",
    displayName: "ABCMSP",
    mspSlug: "abcmsp",
    oidcStatus: "configured",
    planId: "abcmsp-nfr",
    primaryContactEmail: "taylor@abcmsp.com",
    tenantSlug: "abcmsp"
  },
  {
    accessMode: "oidc",
    displayName: "Northwind MSP",
    mspSlug: "northwind",
    oidcStatus: "configured",
    planId: "northwind-nfr",
    primaryContactEmail: "avery@northwindmsp.com",
    tenantSlug: "northwind"
  }
];

export function buildTenantRegistry(enrollments: DemoEnrollment[] = []) {
  const enrollmentEntries: TenantRegistryEntry[] = enrollments.map((enrollment) => ({
    accessMode: enrollment.accessMode,
    displayName: enrollment.mspName,
    mspSlug: enrollment.mspSlug,
    oidcStatus: enrollment.oidcStatus,
    planId: enrollment.planId,
    primaryContactEmail: enrollment.primaryContactEmail,
    tenantSlug: enrollment.tenantName ?? enrollment.mspSlug
  }));

  const registry = [...tenantRegistry];

  enrollmentEntries.forEach((entry) => {
    if (!registry.some((item) => normalizeTenantName(item.tenantSlug) === normalizeTenantName(entry.tenantSlug))) {
      registry.push(entry);
    }
  });

  return registry;
}

export function normalizeTenantName(input?: string | null) {
  if (!input) {
    return "";
  }

  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findTenantByInput(input?: string | null) {
  return findTenantByInputWithRegistry(input, tenantRegistry);
}

export function findTenantByInputWithRegistry(
  input: string | null | undefined,
  registry: TenantRegistryEntry[]
) {
  const normalizedInput = normalizeTenantName(input);

  if (!normalizedInput) {
    return null;
  }

  return (
    registry.find((entry) => {
      const candidates = [entry.tenantSlug, entry.displayName, entry.mspSlug];
      return candidates.some((candidate) => normalizeTenantName(candidate) === normalizedInput);
    }) ?? null
  );
}

export function getDemoPlanUrlForTenant(input?: string | null) {
  return getDemoPlanUrlForTenantWithRegistry(input, tenantRegistry);
}

export function getDemoPlanUrlForTenantWithRegistry(
  input: string | null | undefined,
  registry: TenantRegistryEntry[]
) {
  const tenant = findTenantByInputWithRegistry(input, registry);

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

export function readDemoEnrollmentsFromStorage() {
  if (typeof window === "undefined") {
    return [] as DemoEnrollment[];
  }

  const rawValue = window.localStorage.getItem(DEMO_ENROLLMENTS_STORAGE_KEY);

  if (!rawValue) {
    return [] as DemoEnrollment[];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed) ? (parsed as DemoEnrollment[]) : [];
  } catch {
    return [] as DemoEnrollment[];
  }
}

export function saveDemoEnrollmentsToStorage(enrollments: DemoEnrollment[]) {
  if (typeof window === "undefined") {
    return;
  }

  // Production must store OIDC client secrets server-side using encrypted storage or a secrets manager.
  // Demo storage intentionally persists only whether a secret was provided plus a masked placeholder.
  window.localStorage.setItem(DEMO_ENROLLMENTS_STORAGE_KEY, JSON.stringify(enrollments));
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
