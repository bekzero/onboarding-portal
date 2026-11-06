import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor } from "@/lib/admin-auth";
import { getZohoAdminErrorStatus, updatePlanSalesEngineer } from "@/lib/zoho-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const { planId } = await params;
    const body = (await request.json()) as {
      bookingUrl?: unknown;
      email?: unknown;
      name?: unknown;
    };
    const salesEngineer = await updatePlanSalesEngineer(planId, body, getAdminAuditActor());
    return NextResponse.json({ salesEngineer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the Sales Engineer.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}
