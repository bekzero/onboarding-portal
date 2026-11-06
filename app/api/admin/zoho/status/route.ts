import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoPhase2Status } from "@/lib/zoho-phase2";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  try {
    return NextResponse.json(
      await getZohoPhase2Status(request.nextUrl.searchParams.get("planId") ?? undefined)
    );
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
