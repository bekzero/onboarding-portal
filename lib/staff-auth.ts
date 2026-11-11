import "server-only";

import { auth } from "@/auth";
import {
  authorizeStaffIdentity,
  staffRoleAllows,
  type StaffRole
} from "@/lib/staff-authorization-core";
import { findApprovedStaffIdentity, getStaffSsoRuntimeConfiguration } from "@/lib/staff-sso-config";

export type AuthenticatedStaffIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean | null;
  name: string | null;
  role: StaffRole;
};

function value(name: string) {
  return process.env[name]?.trim() || "";
}

export async function isStaffOidcConfigured() {
  const config = await getStaffSsoRuntimeConfiguration();
  return Boolean(value("AUTH_SECRET") && config.testable);
}

function staffPolicy() {
  return {
    trustedIssuer: value("STAFF_AUTH_ISSUER"),
    adminRole: value("STAFF_AUTH_ADMIN_ROLE"),
    salesEngineerRole: value("STAFF_AUTH_SALES_ENGINEER_ROLE"),
    viewerRole: value("STAFF_AUTH_VIEWER_ROLE"),
    allowedSubjects: new Set(value("STAFF_AUTH_ALLOWED_SUBJECTS").split(",").map((item) => item.trim()).filter(Boolean))
  };
}

export async function getAuthenticatedStaffIdentity(): Promise<AuthenticatedStaffIdentity | null> {
  if (!(await isStaffOidcConfigured())) return null;
  const session = await auth();
  const user = session?.user;
  if (!user?.staff_subject || !user.staff_issuer || !Array.isArray(user.staff_roles) || user.staff_test_only) return null;
  const runtime = await getStaffSsoRuntimeConfiguration();
  if (runtime.source === "database") {
    if (!runtime.enabled) return null;
    const approved = await findApprovedStaffIdentity(user.staff_issuer, user.staff_subject);
    if (!approved?.active || !user.staff_roles.includes(approved.role)) return null;
    return { issuer: user.staff_issuer, subject: user.staff_subject, email: user.email ?? null, emailVerified: user.staff_email_verified ?? null, name: user.name ?? null, role: approved.role };
  }
  const decision = authorizeStaffIdentity({
    issuer: user.staff_issuer,
    subject: user.staff_subject,
    email: user.email,
    emailVerified: user.staff_email_verified,
    claims: { roles: user.staff_roles }
  }, staffPolicy());
  if (!decision.authorized) return null;
  return {
    issuer: user.staff_issuer,
    subject: user.staff_subject,
    email: user.email ?? null,
    emailVerified: user.staff_email_verified ?? null,
    name: user.name ?? null,
    role: decision.role
  };
}

export async function getAuthorizedStaffIdentity(requiredRole: StaffRole) {
  const identity = await getAuthenticatedStaffIdentity();
  return identity && staffRoleAllows(identity.role, requiredRole) ? identity : null;
}

export function formatStaffAuditActor(identity: AuthenticatedStaffIdentity) {
  const verifiedEmail = identity.email && identity.emailVerified ? identity.email : "unverified-or-unavailable";
  return `oidc:${identity.issuer}|sub:${identity.subject}|email:${verifiedEmail}|role:${identity.role}`;
}

export function isTrustedSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : requestOrigin;
    return origin === requestOrigin || origin === configuredOrigin;
  } catch {
    return false;
  }
}
