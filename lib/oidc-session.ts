import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const OIDC_STATE_COOKIE = "kzero_oidc_state";
const OIDC_PORTAL_SESSION_COOKIE = "kzero_portal_session";
const STATE_TTL_SECONDS = 60 * 10;
const PORTAL_SESSION_TTL_SECONDS = 60 * 60 * 8;

type SignedPayload = {
  expiresAt: number;
};

export type OidcStateSession = SignedPayload & {
  lookupValue: string;
  nonce: string;
  planId: string;
  state: string;
  tenantName: string;
};

export type PortalOidcSession = SignedPayload & {
  authenticated: true;
  email?: string;
  planId: string;
  tenantName: string;
};

function getAuthSecret() {
  return process.env.AUTH_SECRET?.trim() || "";
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value: string) {
  const secret = getAuthSecret();

  if (!secret) {
    return null;
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sealPayload<T extends SignedPayload>(payload: T) {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload);

  if (!signature) {
    return null;
  }

  return `${encodedPayload}.${signature}`;
}

function unsealPayload<T extends SignedPayload>(value?: string | null) {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);

  if (!expectedSignature || !safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as T;

    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function buildCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  };
}

export function createOpaqueOidcValue() {
  return randomBytes(18).toString("hex");
}

export async function writeOidcStateSession(session: OidcStateSession) {
  const sealed = sealPayload(session);

  if (!sealed) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: OIDC_STATE_COOKIE,
    value: sealed,
    ...buildCookieOptions(STATE_TTL_SECONDS)
  });

  return true;
}

export async function readOidcStateSession() {
  const cookieStore = await cookies();
  return unsealPayload<OidcStateSession>(cookieStore.get(OIDC_STATE_COOKIE)?.value);
}

export async function clearOidcStateSession() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: OIDC_STATE_COOKIE,
    value: "",
    ...buildCookieOptions(0)
  });
}

export async function writePortalSession(session: Omit<PortalOidcSession, "authenticated" | "expiresAt">) {
  const sealed = sealPayload({
    authenticated: true,
    ...session,
    expiresAt: Date.now() + PORTAL_SESSION_TTL_SECONDS * 1000
  });

  if (!sealed) {
    return false;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: OIDC_PORTAL_SESSION_COOKIE,
    value: sealed,
    ...buildCookieOptions(PORTAL_SESSION_TTL_SECONDS)
  });

  return true;
}

export async function writePortalOidcSession(session: Omit<PortalOidcSession, "authenticated" | "expiresAt">) {
  return writePortalSession(session);
}

export async function readPortalOidcSession() {
  const cookieStore = await cookies();
  return unsealPayload<PortalOidcSession>(cookieStore.get(OIDC_PORTAL_SESSION_COOKIE)?.value);
}

export async function clearPortalOidcSession() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: OIDC_PORTAL_SESSION_COOKIE,
    value: "",
    ...buildCookieOptions(0)
  });
}
