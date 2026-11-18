import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { executeSingleContactPilot } from "@/lib/zoho-single-contact-pilot";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated ADMIN identity is required." }, { status: 403 });

  try {
    const body = (await request.json()) as { confirmation?: unknown };
    const { planId } = await context.params;
    return NextResponse.json(await executeSingleContactPilot({
      actor,
      confirmation: typeof body.confirmation === "string" ? body.confirmation : "",
      planId
    }));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
