"use server";

import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/admin-auth";
import { createStaffSsoBootstrapAuthorization } from "@/lib/staff-sso-bootstrap";

export async function authorizeStaffSsoBootstrap(formData: FormData) {
  if (!(await hasAdminSession())) redirect("/admin-login");
  const secret = typeof formData.get("bootstrapSecret") === "string" ? String(formData.get("bootstrapSecret")) : "";
  const authorized = await createStaffSsoBootstrapAuthorization(secret);
  redirect(`/admin/settings/sso?bootstrap=${authorized ? "authorized" : "denied"}`);
}
