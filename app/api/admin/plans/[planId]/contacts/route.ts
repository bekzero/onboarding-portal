import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor } from "@/lib/admin-auth";
import {
  addPlanContact,
  getPlanAutomationAdminDetails,
  getZohoAdminErrorStatus
} from "@/lib/zoho-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

  try {
    const { planId } = await params;
    const details = await getPlanAutomationAdminDetails(planId);
    if (!details) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }
    return NextResponse.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load onboarding contacts.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const { planId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contact = await addPlanContact(planId, body, getAdminAuditActor());
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add onboarding contact.";
    return NextResponse.json({ error: message }, { status: getZohoAdminErrorStatus(error) });
  }
}
