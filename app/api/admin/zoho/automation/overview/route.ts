import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoAdminOverview } from "@/lib/zoho-admin-center";

export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  return NextResponse.json(await getZohoAdminOverview());
}
