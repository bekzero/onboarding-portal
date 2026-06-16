import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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
    sameSite: "lax",
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
