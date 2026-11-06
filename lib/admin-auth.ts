import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import {
  formatStaffAuditActor,
  getAuthenticatedStaffIdentity,
  getAuthorizedStaffIdentity,
  isTrustedSameOriginRequest
} from "@/lib/staff-auth";
import { staffRoleAllows, type StaffRole } from "@/lib/staff-authorization-core";

export const ADMIN_SESSION_UNAVAILABLE_MESSAGE =
  "Admin session unavailable. Open the dashboard in a new tab or sign in again.";

function getCookieName() {
  return process.env.ADMIN_SESSION_COOKIE || "kzero_admin_session";
}

function getAccessCode() {
  return process.env.ADMIN_ACCESS_CODE?.trim() || "";
}

function hashAccessCode(accessCode: string) {
  return createHash("sha256").update(`${accessCode}:kzero-admin`).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminAccessConfigured() {
  return Boolean(getAccessCode());
}

export async function createAdminSession() {
  const accessCode = getAccessCode();

  if (!accessCode) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: getCookieName(),
    value: hashAccessCode(accessCode),
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production"
  });

  return true;
}

export async function hasAdminSession() {
  const accessCode = getAccessCode();

  if (!accessCode) {
    return false;
  }

  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(getCookieName())?.value;

  if (!sessionValue) {
    return false;
  }

  return safeEqual(sessionValue, hashAccessCode(accessCode));
}

export async function requireAdminSession() {
  if (!(await hasAdminSession())) {
    redirect("/admin-login");
  }
}

export async function getAdminApiAuthError(requiredRole: StaffRole = "VIEWER") {
  if (await hasAdminSession()) {
    if (requiredRole === "ADMIN") {
      return NextResponse.json(
        { code: "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED", error: INDIVIDUAL_ADMIN_IDENTITY_REQUIRED },
        { status: 403 }
      );
    }
    return null;
  }
  const identity = await getAuthenticatedStaffIdentity();
  if (!identity) return NextResponse.json({ error: ADMIN_SESSION_UNAVAILABLE_MESSAGE }, { status: 401 });
  if (!staffRoleAllows(identity.role, requiredRole)) {
    return NextResponse.json(
      { code: "STAFF_ROLE_FORBIDDEN", error: `This operation requires the ${requiredRole} staff role.` },
      { status: 403 }
    );
  }
  return null;
}

export function getAdminAuditActor() {
  return process.env.ADMIN_AUDIT_ACTOR?.trim() || "admin-session";
}

export const INDIVIDUAL_ADMIN_IDENTITY_REQUIRED =
  "This action requires an individually attributable administrator session. The current shared admin access-code session is read-only for sensitive Zoho operations.";

/**
 * The current access-code cookie proves possession of a shared secret, not the
 * identity of a person. Environment labels and user-entered names are not
 * authentication. Sensitive Zoho operations therefore require the separately
 * configured staff OIDC provider and an authorized application role.
 */
export async function getSensitiveAdminApiAuthError(request?: Request, requiredRole: StaffRole = "ADMIN") {
  const identity = await getAuthenticatedStaffIdentity();
  if (!identity) {
    return NextResponse.json(
      { code: "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED", error: INDIVIDUAL_ADMIN_IDENTITY_REQUIRED },
      { status: 403 }
    );
  }
  if (!(await getAuthorizedStaffIdentity(requiredRole))) {
    return NextResponse.json(
      { code: "STAFF_ROLE_FORBIDDEN", error: `This action requires the ${requiredRole} staff role.` },
      { status: 403 }
    );
  }
  if (request && !isTrustedSameOriginRequest(request)) {
    return NextResponse.json(
      { code: "UNTRUSTED_REQUEST_ORIGIN", error: "The request origin could not be verified." },
      { status: 403 }
    );
  }
  return null;
}

export async function getSensitiveAdminAuditActor() {
  const identity = await getAuthorizedStaffIdentity("ADMIN");
  return identity ? formatStaffAuditActor(identity) : null;
}

export async function hasAnyAdminAccess() {
  return (await hasAdminSession()) || Boolean(await getAuthenticatedStaffIdentity());
}

export async function getCurrentStaffIdentity() {
  return getAuthenticatedStaffIdentity();
}
