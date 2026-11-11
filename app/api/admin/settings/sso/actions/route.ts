import { StaffApplicationRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { enableStaffSso, disableStaffSso, getStaffSsoSettingsActor } from "@/lib/staff-sso-admin";
import { testStaffSsoDiscovery } from "@/lib/staff-sso-discovery";
import { getStoredStaffSsoConfiguration, removeStaffIdentity, upsertStaffIdentity, validateStaffSsoInput } from "@/lib/staff-sso-config";

export async function POST(request: Request) {
  const actor = await getStaffSsoSettingsActor(request);
  if (!actor) return NextResponse.json({ error: "This operation requires an individually authenticated ADMIN or active deployment-owner bootstrap authorization." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "validate": {
        const config = await getStoredStaffSsoConfiguration();
        if (!config) throw new Error("Save a configuration draft first.");
        validateStaffSsoInput({ realmName: config.realmName, clientId: config.clientId, clientSecret: "", issuerUrl: config.issuerUrl, applicationOrigin: config.applicationOrigin, postLogoutRedirectUri: config.postLogoutRedirectUri, adminRoleClaim: config.adminRoleClaim ?? undefined, salesEngineerRoleClaim: config.salesEngineerRoleClaim ?? undefined, viewerRoleClaim: config.viewerRoleClaim ?? undefined, approvedGroupClaim: config.approvedGroupClaim ?? undefined });
        return NextResponse.json({ result: { valid: true } });
      }
      case "test-discovery": return NextResponse.json({ result: await testStaffSsoDiscovery(actor) });
      case "enable": return NextResponse.json({ result: await enableStaffSso(actor) });
      case "disable": return NextResponse.json({ result: await disableStaffSso(actor) });
      case "upsert-identity": {
        if (!Object.values(StaffApplicationRole).includes(body.role as StaffApplicationRole)) throw new Error("A valid staff role is required.");
        return NextResponse.json({ result: await upsertStaffIdentity({ issuer: String(body.issuer || ""), subject: String(body.subject || ""), email: typeof body.email === "string" ? body.email : null, displayName: typeof body.displayName === "string" ? body.displayName : null, role: body.role as StaffApplicationRole, active: body.active !== false }, actor) });
      }
      case "remove-identity": await removeStaffIdentity(String(body.id || ""), actor); return NextResponse.json({ ok: true });
      default: return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Staff SSO action failed." }, { status: 400 });
  }
}
