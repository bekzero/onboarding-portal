"use server";

import { signIn, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { clearAdminSession } from "@/lib/admin-auth";
import { isStaffOidcConfigured } from "@/lib/staff-auth";

function safeReturnTo(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/admin") && !path.startsWith("//") ? path : "/admin";
}

export async function signInStaff(formData: FormData) {
  if (!(await isStaffOidcConfigured())) return;
  await signIn("kzero-staff", { redirectTo: safeReturnTo(formData.get("returnTo")) });
}

export async function signOutStaff() {
  await signOut({ redirectTo: "/admin-login?staff=logged_out" });
}

export async function signOutSharedAdmin() {
  await clearAdminSession();
  redirect("/admin-login?logged_out=1");
}
