import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError } from "@/lib/admin-auth";
import { previewSingleContactPilot } from "@/lib/zoho-single-contact-pilot";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  try {
    const { planId } = await context.params;
    return NextResponse.json(await previewSingleContactPilot({ planId, staffAdminAuthorized: true }));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
