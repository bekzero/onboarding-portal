import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { previewZohoTestSync } from "@/lib/zoho-phase2";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;
  try {
    const body = (await request.json()) as { contactId?: unknown; planId?: unknown };
    if (typeof body.planId !== "string" || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "A plan and contact are required." }, { status: 400 });
    }
    return NextResponse.json(await previewZohoTestSync(body.planId, body.contactId));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
