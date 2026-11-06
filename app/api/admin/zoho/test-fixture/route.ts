import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";
import { activateIsolatedZohoTestPlan } from "@/lib/zoho-test-fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("ADMIN");
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated staff identity is required." }, { status: 403 });

  try {
    const body = (await request.json()) as {
      confirmation?: unknown;
      contactId?: unknown;
      planId?: unknown;
    };
    if (typeof body.planId !== "string" || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "A test plan and contact are required." }, { status: 400 });
    }
    return NextResponse.json(
      await activateIsolatedZohoTestPlan({
        actor,
        confirmation: body.confirmation,
        contactId: body.contactId,
        planId: body.planId
      })
    );
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
