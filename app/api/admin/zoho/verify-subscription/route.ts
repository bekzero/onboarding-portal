import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { verifyPlanContactSubscription } from "@/lib/zoho-phase2";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated staff identity is required." }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.planId !== "string" || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "A plan and contact are required." }, { status: 400 });
    }
    const updated = await verifyPlanContactSubscription({
      actor,
      contactId: body.contactId,
      evidenceReference: body.evidenceReference,
      planId: body.planId,
      reason: body.reason,
      status: body.status
    });
    return NextResponse.json({ contact: updated });
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
