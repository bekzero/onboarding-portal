"use server";

import { signIn, signOut } from "@/auth";
import { isStaffOidcConfigured } from "@/lib/staff-auth";

function safeReturnTo(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/admin") && !path.startsWith("//") ? path : "/admin";
}

export async function signInStaff(formData: FormData) {
  if (!isStaffOidcConfigured()) return;
  await signIn("kzero-staff", { redirectTo: safeReturnTo(formData.get("returnTo")) });
}

export async function signOutStaff() {
  await signOut({ redirectTo: "/admin-login?staff=logged_out" });
}
