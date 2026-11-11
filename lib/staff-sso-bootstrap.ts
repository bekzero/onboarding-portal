import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  createStaffSsoBootstrapToken,
  isStaffSsoBootstrapSecretValid,
  isStaffSsoBootstrapTokenValid,
  STAFF_SSO_BOOTSTRAP_COOKIE_NAME,
  STAFF_SSO_BOOTSTRAP_COOKIE_PATH,
  STAFF_SSO_BOOTSTRAP_MAX_AGE_SECONDS
} from "@/lib/staff-sso-bootstrap-token";

const LEGACY_COOKIE_NAME = "kzero_staff_sso_bootstrap";
const LEGACY_COOKIE_PATH = "/admin/settings/sso";

function bootstrapSecret() {
  const secret = process.env.STAFF_SSO_BOOTSTRAP_SECRET?.trim() || "";
  if (secret.length < 32) throw new Error("STAFF_SSO_BOOTSTRAP_SECRET must contain at least 32 characters.");
  return secret;
}

function cookieSecurityOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const
  };
}

export async function createStaffSsoBootstrapAuthorization(presentedSecret: string) {
  const expected = bootstrapSecret();
  if (!isStaffSsoBootstrapSecretValid(presentedSecret, expected)) return false;
  const expires = Math.floor(Date.now() / 1000) + STAFF_SSO_BOOTSTRAP_MAX_AGE_SECONDS;
  const token = createStaffSsoBootstrapToken(expires, randomBytes(16).toString("base64url"), expected);
  const cookieStore = await cookies();
  cookieStore.set({
    name: STAFF_SSO_BOOTSTRAP_COOKIE_NAME,
    value: token,
    ...cookieSecurityOptions(),
    path: STAFF_SSO_BOOTSTRAP_COOKIE_PATH,
    maxAge: STAFF_SSO_BOOTSTRAP_MAX_AGE_SECONDS
  });
  cookieStore.set({ name: LEGACY_COOKIE_NAME, value: "", ...cookieSecurityOptions(), path: LEGACY_COOKIE_PATH, maxAge: 0 });
  return true;
}

export async function hasStaffSsoBootstrapAuthorization() {
  const value = (await cookies()).get(STAFF_SSO_BOOTSTRAP_COOKIE_NAME)?.value;
  if (!value) return false;
  return isStaffSsoBootstrapTokenValid(value, bootstrapSecret(), Math.floor(Date.now() / 1000));
}

export async function clearStaffSsoBootstrapAuthorization() {
  const cookieStore = await cookies();
  cookieStore.set({ name: STAFF_SSO_BOOTSTRAP_COOKIE_NAME, value: "", ...cookieSecurityOptions(), path: STAFF_SSO_BOOTSTRAP_COOKIE_PATH, maxAge: 0 });
  cookieStore.set({ name: LEGACY_COOKIE_NAME, value: "", ...cookieSecurityOptions(), path: LEGACY_COOKIE_PATH, maxAge: 0 });
}
