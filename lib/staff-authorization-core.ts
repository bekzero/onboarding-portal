export type StaffRole = "ADMIN" | "SALES_ENGINEER" | "VIEWER";

export type StaffAuthorizationInput = {
  issuer: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean | null;
  claims: Record<string, unknown>;
};

export type StaffAuthorizationPolicy = {
  trustedIssuer: string;
  adminRole: string;
  salesEngineerRole: string;
  viewerRole: string;
  allowedSubjects: Set<string>;
};

function normalizeIssuer(value: string) {
  return value.trim().replace(/\/$/, "");
}

function addStrings(target: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    value.filter((item): item is string => typeof item === "string").forEach((item) => target.add(item));
  }
}

export function extractTrustedStaffRoles(claims: Record<string, unknown>, clientId?: string) {
  const roles = new Set<string>();
  const realmAccess = claims.realm_access;
  if (realmAccess && typeof realmAccess === "object") addStrings(roles, (realmAccess as Record<string, unknown>).roles);
  const resourceAccess = claims.resource_access;
  if (resourceAccess && typeof resourceAccess === "object") {
    const resources = resourceAccess as Record<string, unknown>;
    const entries = clientId && resources[clientId] ? [resources[clientId]] : Object.values(resources);
    for (const entry of entries) {
      if (entry && typeof entry === "object") addStrings(roles, (entry as Record<string, unknown>).roles);
    }
  }
  addStrings(roles, claims.roles);
  addStrings(roles, claims.groups);
  addStrings(roles, claims.organization_roles);
  return [...roles];
}

export function authorizeStaffIdentity(input: StaffAuthorizationInput, policy: StaffAuthorizationPolicy) {
  if (!policy.trustedIssuer || normalizeIssuer(input.issuer) !== normalizeIssuer(policy.trustedIssuer)) {
    return { authorized: false as const, reason: "UNTRUSTED_ISSUER" };
  }
  if (!input.subject.trim()) return { authorized: false as const, reason: "MISSING_SUBJECT" };
  if (policy.allowedSubjects.size > 0 && !policy.allowedSubjects.has(input.subject)) {
    return { authorized: false as const, reason: "SUBJECT_NOT_ALLOWLISTED" };
  }
  const roles = new Set(extractTrustedStaffRoles(input.claims));
  let role: StaffRole | null = null;
  if (policy.adminRole && roles.has(policy.adminRole)) role = "ADMIN";
  else if (policy.salesEngineerRole && roles.has(policy.salesEngineerRole)) role = "SALES_ENGINEER";
  else if (policy.viewerRole && roles.has(policy.viewerRole)) role = "VIEWER";
  if (!role) return { authorized: false as const, reason: "APP_ROLE_REQUIRED" };
  return { authorized: true as const, role, roles: [...roles] };
}

export function staffRoleAllows(actual: StaffRole, required: StaffRole) {
  const rank: Record<StaffRole, number> = { VIEWER: 1, SALES_ENGINEER: 2, ADMIN: 3 };
  return rank[actual] >= rank[required];
}
