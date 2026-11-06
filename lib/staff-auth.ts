import "server-only";

import { auth } from "@/auth";
import {
  authorizeStaffIdentity,
  staffRoleAllows,
  type StaffRole
} from "@/lib/staff-authorization-core";

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

export function isStaffOidcConfigured() {
  return Boolean(
    value("AUTH_SECRET") && value("STAFF_AUTH_ISSUER") && value("STAFF_AUTH_CLIENT_ID") &&
    value("STAFF_AUTH_CLIENT_SECRET") &&
    (value("STAFF_AUTH_ADMIN_ROLE") || value("STAFF_AUTH_SALES_ENGINEER_ROLE") || value("STAFF_AUTH_VIEWER_ROLE"))
  );
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
  if (!isStaffOidcConfigured()) return null;
  const session = await auth();
  const user = session?.user;
  if (!user?.staff_subject || !user.staff_issuer || !Array.isArray(user.staff_roles)) return null;
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
