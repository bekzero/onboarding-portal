import type { OnboardingCase } from "@/lib/mock-data";

export const ADMIN_CASE_OVERRIDES_STORAGE_KEY = "kzero-admin-case-overrides";

export type AdminCaseOverride = Partial<
  Pick<
    OnboardingCase,
    | "accessMode"
    | "currentStage"
    | "lastActivity"
    | "mspName"
    | "oidcClientId"
    | "oidcClientSecretConfigured"
    | "oidcStatus"
    | "primaryContactEmail"
    | "progress"
    | "startingPlanType"
    | "status"
    | "submittedSaasAppCount"
    | "tenantName"
  >
> & {
  deleted?: boolean;
};

export function readAdminCaseOverridesFromStorage() {
  if (typeof window === "undefined") {
    return {} as Record<string, AdminCaseOverride>;
  }

  const rawValue = window.localStorage.getItem(ADMIN_CASE_OVERRIDES_STORAGE_KEY);

  if (!rawValue) {
    return {} as Record<string, AdminCaseOverride>;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, AdminCaseOverride>) : {};
  } catch {
    return {} as Record<string, AdminCaseOverride>;
  }
}

export function saveAdminCaseOverridesToStorage(overrides: Record<string, AdminCaseOverride>) {
  if (typeof window === "undefined") {
    return;
  }

  // TODO: production must store MSP configuration updates in a backend system.
  // Client-side demo storage must never contain real OIDC secrets or other sensitive credentials.
  window.localStorage.setItem(ADMIN_CASE_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
}
