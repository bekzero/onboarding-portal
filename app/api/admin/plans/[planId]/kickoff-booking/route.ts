import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor } from "@/lib/admin-auth";
import { getZohoAdminErrorStatus, updateKickoffBooking } from "@/lib/zoho-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const { planId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "book" | "cancel" | "correct";
      bookedAt?: unknown;
      reason?: unknown;
    };
    const action = body.action ?? "book";
    if (!(["book", "cancel", "correct"] as const).includes(action)) {
      return NextResponse.json({ error: "Select a valid kickoff booking action." }, { status: 400 });
    }
    const result = await updateKickoffBooking(
      planId,
      { action, bookedAt: body.bookedAt, reason: body.reason },
      getAdminAuditActor()
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update kickoff booking.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}
