import { createHmac, timingSafeEqual } from "node:crypto";

export const STAFF_SSO_BOOTSTRAP_COOKIE_NAME = "kzero_staff_sso_bootstrap_v2";
export const STAFF_SSO_BOOTSTRAP_COOKIE_PATH = "/";
export const STAFF_SSO_BOOTSTRAP_MAX_AGE_SECONDS = 15 * 60;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isStaffSsoBootstrapSecretValid(presentedSecret: string, expectedSecret: string) {
  const presented = createHmac("sha256", expectedSecret).update(presentedSecret).digest("hex");
  const expected = createHmac("sha256", expectedSecret).update(expectedSecret).digest("hex");
  return safeEqual(presented, expected);
}

export function createStaffSsoBootstrapToken(expiresAtSeconds: number, nonce: string, secret: string) {
  const payload = `${expiresAtSeconds}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function isStaffSsoBootstrapTokenValid(value: string, secret: string, nowSeconds: number) {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], sign(payload, secret));
}
