import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoAdminContacts } from "@/lib/zoho-admin-center";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  return NextResponse.json(await getZohoAdminContacts(new URL(request.url).searchParams));
}
