"use server";

import { redirect } from "next/navigation";
import { createAdminSession, isAdminAccessConfigured } from "@/lib/admin-auth";

export async function submitAdminLogin(formData: FormData) {
  if (!isAdminAccessConfigured()) {
    redirect("/admin-login?setup=1");
  }

  const submittedCode = String(formData.get("accessCode") || "").trim();
  const expectedCode = process.env.ADMIN_ACCESS_CODE?.trim() || "";

  if (!submittedCode || submittedCode !== expectedCode) {
    redirect("/admin-login?error=1");
  }

  await createAdminSession();
  redirect("/admin");
}
