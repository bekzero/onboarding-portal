import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getStaffSsoSettingsActor } from "@/lib/staff-sso-admin";
import { getStoredStaffSsoConfiguration, saveStaffSsoDraft, serializeStaffSsoConfiguration, type StaffSsoInput } from "@/lib/staff-sso-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const error = await getAdminApiAuthError("VIEWER");
  if (error) return error;
  return NextResponse.json({ configuration: serializeStaffSsoConfiguration(await getStoredStaffSsoConfiguration()) });
}

export async function PUT(request: Request) {
  const actor = await getStaffSsoSettingsActor(request);
  if (!actor) return NextResponse.json({ error: "An individually authenticated ADMIN or active deployment-owner bootstrap authorization is required." }, { status: 403 });
  try {
    const body = await request.json() as StaffSsoInput;
    await saveStaffSsoDraft(body, actor);
    return NextResponse.json({ configuration: serializeStaffSsoConfiguration(await getStoredStaffSsoConfiguration()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration could not be saved." }, { status: 400 });
  }
}
