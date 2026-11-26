import { NextResponse } from "next/server";
import {
  getAdminApiAuthError,
  getCurrentStaffIdentity,
  getSensitiveAdminApiAuthError,
  getSensitiveAdminAuditActor
} from "@/lib/admin-auth";
import {
  disableZohoEmailAutomation,
  enableZohoEmailAutomation,
  getZohoEmailAutomationStatus
} from "@/lib/zoho-email-automation";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const { planId } = await context.params;
  const identity = await getCurrentStaffIdentity();
  const status = await getZohoEmailAutomationStatus(planId, { canManage: identity?.role === "ADMIN" });
  return status
    ? NextResponse.json(status)
    : NextResponse.json({ code: "PLAN_NOT_FOUND", error: "This onboarding case could not be found." }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) {
    return NextResponse.json({ code: "INDIVIDUAL_ADMIN_IDENTITY_REQUIRED", error: "An individual Staff ADMIN session is required." }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null) as { action?: unknown; confirmed?: unknown } | null;
    if (body?.confirmed !== true || (body.action !== "ENABLE" && body.action !== "DISABLE")) {
      return NextResponse.json({ code: "EXPLICIT_CONFIRMATION_REQUIRED", error: "Confirm the selected automated-email action." }, { status: 400 });
    }
    const { planId } = await context.params;
    if (body.action === "ENABLE") await enableZohoEmailAutomation({ actor, planId });
    else await disableZohoEmailAutomation({ actor, planId });
    const status = await getZohoEmailAutomationStatus(planId, { canManage: true });
    return NextResponse.json({ action: body.action, status });
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
