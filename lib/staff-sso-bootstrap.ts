import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "kzero_staff_sso_bootstrap";
const MAX_AGE_SECONDS = 15 * 60;

function bootstrapSecret() {
  const secret = process.env.STAFF_SSO_BOOTSTRAP_SECRET?.trim() || "";
  if (secret.length < 32) throw new Error("STAFF_SSO_BOOTSTRAP_SECRET must contain at least 32 characters.");
  return secret;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string) {
  return createHmac("sha256", bootstrapSecret()).update(payload).digest("base64url");
}

export async function createStaffSsoBootstrapAuthorization(presentedSecret: string) {
  const expected = bootstrapSecret();
  if (!safeEqual(createHmac("sha256", expected).update(presentedSecret).digest("hex"), createHmac("sha256", expected).update(expected).digest("hex"))) return false;
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${expires}.${randomBytes(16).toString("base64url")}`;
  (await cookies()).set({ name: COOKIE_NAME, value: `${payload}.${sign(payload)}`, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/admin/settings/sso", maxAge: MAX_AGE_SECONDS });
  return true;
}

export async function hasStaffSsoBootstrapAuthorization() {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload))) return false;
  return Number(parts[0]) > Math.floor(Date.now() / 1000);
}

export async function clearStaffSsoBootstrapAuthorization() {
  (await cookies()).delete(COOKIE_NAME);
}
