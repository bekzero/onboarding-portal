import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor } from "@/lib/admin-auth";
import { discoverZohoFields, discoverZohoJourneys } from "@/lib/zoho-phase2";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as { operation?: unknown };
    if (!(["fields", "journeys", "all"] as unknown[]).includes(body.operation)) {
      return NextResponse.json({ error: "Select fields, journeys, or all." }, { status: 400 });
    }
    const actor = getAdminAuditActor();
    const result: Record<string, unknown> = {};
    if (body.operation === "fields" || body.operation === "all") {
      result.fields = await discoverZohoFields(actor);
    }
    if (body.operation === "journeys" || body.operation === "all") {
      result.journeys = await discoverZohoJourneys(actor);
    }
    return NextResponse.json(result);
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
