import type { AdminCaseOverride } from "@/lib/admin-case-storage";

export type TenantRegistryEntry = {
  accessMode: "temporary" | "oidc";
  displayName: string;
  mspSlug: string;
  oidcStatus: "not_configured" | "configured";
  planId: string;
  primaryContactEmail: string;
  tenantName?: string;
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
    tenantName: "ABCMSP"
  },
  {
    accessMode: "oidc",
    displayName: "Northwind MSP",
    mspSlug: "northwind",
    oidcStatus: "configured",
    planId: "northwind-nfr",
    primaryContactEmail: "avery@northwindmsp.com",
    tenantName: "northwind"
  },
  {
    accessMode: "oidc",
    displayName: "PeakPoint MSP",
    mspSlug: "peakpoint",
    oidcStatus: "configured",
    planId: "peakpoint-nfr",
    primaryContactEmail: "casey@peakpointmsp.com",
    tenantName: "peakpoint"
  },
  {
    accessMode: "temporary",
    displayName: "Skyline MSP",
    mspSlug: "skyline",
    oidcStatus: "not_configured",
    planId: "skyline-nfr",
    primaryContactEmail: "jamie@skylinemsp.com",
    tenantName: undefined
  }
];

function applyOverrideToRegistryEntry(
  entry: TenantRegistryEntry,
  overrides: Record<string, AdminCaseOverride>
) {
  const override = overrides[entry.planId];

  if (!override) {
    return entry;
  }

  return {
    ...entry,
    accessMode: override.accessMode ?? entry.accessMode,
    displayName: override.mspName ?? entry.displayName,
    oidcStatus: override.oidcStatus ?? entry.oidcStatus,
    primaryContactEmail: override.primaryContactEmail ?? entry.primaryContactEmail,
    tenantName: override.tenantName ?? entry.tenantName
  } satisfies TenantRegistryEntry;
}

export function buildTenantRegistry(
  enrollments: DemoEnrollment[] = [],
  overrides: Record<string, AdminCaseOverride> = {}
) {
  const enrollmentEntries: TenantRegistryEntry[] = enrollments.map((enrollment) => ({
    accessMode: enrollment.accessMode,
    displayName: enrollment.mspName,
    mspSlug: enrollment.mspSlug,
    oidcStatus: enrollment.oidcStatus,
    planId: enrollment.planId,
    primaryContactEmail: enrollment.primaryContactEmail,
    tenantName: enrollment.tenantName
  }));

  const registry = tenantRegistry.map((entry) => applyOverrideToRegistryEntry(entry, overrides));

  enrollmentEntries.forEach((entry) => {
    const override = overrides[entry.planId];
    const nextEntry = override
      ? {
          ...entry,
          accessMode: override.accessMode ?? entry.accessMode,
          displayName: override.mspName ?? entry.displayName,
          oidcStatus: override.oidcStatus ?? entry.oidcStatus,
          primaryContactEmail: override.primaryContactEmail ?? entry.primaryContactEmail,
          tenantName: override.tenantName ?? entry.tenantName
        }
      : entry;

    if (!registry.some((item) => normalizeTenantName(item.planId) === normalizeTenantName(nextEntry.planId))) {
      registry.push(nextEntry);
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

function normalizeLookupValue(input?: string | null) {
  return normalizeTenantName(input);
}

export function findTenantByInput(input?: string | null) {
  return findTenantByInputWithRegistry(input, tenantRegistry);
}

export function findTenantByInputWithRegistry(
  input: string | null | undefined,
  registry: TenantRegistryEntry[]
) {
  const normalizedInput = normalizeLookupValue(input);

  if (!normalizedInput) {
    return null;
  }

  return (
    registry.find((entry) => {
      const candidates = [entry.tenantName, entry.displayName, entry.mspSlug];
      return candidates.some((candidate) => normalizeLookupValue(candidate) === normalizedInput);
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

function trimTenantRealmName(input?: string | null) {
  return input?.trim() ?? "";
}

export function buildKzeroIssuerForTenant(tenantName: string) {
  const exactTenantName = trimTenantRealmName(tenantName);

  if (!exactTenantName) {
    return null;
  }

  // Production OIDC should never trust arbitrary tenant input directly.
  // Only allowlisted tenant registry entries should be used to construct live OIDC endpoints.
  return `https://ca.auth.kzero.com/realms/${exactTenantName}`;
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
