import { NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { reconcileUncertainZohoEvent } from "@/lib/zoho-dispatcher";

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated staff identity is required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  if (!(["CONFIRM_TRIGGERED", "CONFIRM_NOT_TRIGGERED_RETRY", "CANCEL"] as unknown[]).includes(action)) {
    return NextResponse.json({ error: "Select a valid reconciliation action." }, { status: 400 });
  }
  try {
    const { eventId } = await context.params;
    return NextResponse.json(await reconcileUncertainZohoEvent({
      action: action as "CONFIRM_TRIGGERED" | "CONFIRM_NOT_TRIGGERED_RETRY" | "CANCEL",
      actor,
      eventId,
      evidenceReference: typeof body?.evidenceReference === "string" ? body.evidenceReference : "",
      reason: typeof body?.reason === "string" ? body.reason : ""
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed." }, { status: 409 });
  }
}
