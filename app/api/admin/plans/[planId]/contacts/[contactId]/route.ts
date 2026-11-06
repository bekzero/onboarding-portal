import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor } from "@/lib/admin-auth";
import {
  getZohoAdminErrorStatus,
  removePlanContact,
  updatePlanContact
} from "@/lib/zoho-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string; planId: string }> }
) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const { contactId, planId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contact = await updatePlanContact(planId, contactId, body, getAdminAuditActor());
    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update onboarding contact.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string; planId: string }> }
) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const { contactId, planId } = await params;
    await removePlanContact(planId, contactId, getAdminAuditActor());
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove onboarding contact.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}
