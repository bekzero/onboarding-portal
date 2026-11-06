import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { checkZohoListMembership } from "@/lib/zoho-phase2";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== "string" || !body.email.trim()) {
      return NextResponse.json({ error: "A contact email is required." }, { status: 400 });
    }
    return NextResponse.json(await checkZohoListMembership(body.email));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
