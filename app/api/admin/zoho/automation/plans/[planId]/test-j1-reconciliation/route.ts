import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { prepareTestJ1SnapshotReconciliation } from "@/lib/zoho-test-j1-reconciliation";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated ADMIN identity is required." }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
    const { planId } = await context.params;
    const result = await prepareTestJ1SnapshotReconciliation({
      actor,
      confirmation: typeof body?.confirmation === "string" ? body.confirmation : "",
      planId
    });
    return NextResponse.json({
      changed: result.changed,
      contactEvent: { id: result.contactEvent.id, status: result.contactEvent.status },
      journeyEvent: { id: result.journeyEvent.id, status: result.journeyEvent.status }
    });
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
