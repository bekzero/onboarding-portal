import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { getExistingFullFieldTestIntent, prepareExistingFullFieldTestIntent } from "@/lib/zoho-existing-plan-test-intent";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const { planId } = await context.params;
  return NextResponse.json({ event: await getExistingFullFieldTestIntent(planId) });
}

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated ADMIN identity is required." }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
    const { planId } = await context.params;
    const result = await prepareExistingFullFieldTestIntent({
      actor,
      confirmation: typeof body?.confirmation === "string" ? body.confirmation : "",
      planId
    });
    return NextResponse.json(result);
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
