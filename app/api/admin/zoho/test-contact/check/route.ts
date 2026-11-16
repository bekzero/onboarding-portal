import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { checkZohoTestContact } from "@/lib/zoho-test-contact";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;
  try {
    const body = (await request.json()) as { email?: unknown };
    return NextResponse.json(await checkZohoTestContact(body.email));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
