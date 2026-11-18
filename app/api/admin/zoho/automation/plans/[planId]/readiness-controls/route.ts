import { NextResponse } from "next/server";
import { getSensitiveAdminApiAuthError, getSensitiveAdminAuditActor } from "@/lib/admin-auth";
import { getZohoPlanAutomationSummary } from "@/lib/zoho-admin-center";
import {
  approvePilotPlanAutomation,
  assignPilotCommunicationContext,
  verifyPilotMailingListPrivacy
} from "@/lib/zoho-pilot-admin";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["APPROVE_AUTOMATION", "ASSIGN_CONTEXT", "VERIFY_LIST_PRIVACY"]);

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getSensitiveAdminApiAuthError(request, "ADMIN");
  if (authError) return authError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated ADMIN identity is required." }, { status: 403 });

  try {
    const body = (await request.json()) as { action?: unknown; confirmed?: unknown };
    if (typeof body.action !== "string" || !ACTIONS.has(body.action) || body.confirmed !== true) {
      return NextResponse.json({ error: "Select and explicitly confirm a supported readiness action." }, { status: 400 });
    }
    const { planId } = await context.params;
    const result = body.action === "APPROVE_AUTOMATION"
      ? await approvePilotPlanAutomation({ actor, planId })
      : body.action === "ASSIGN_CONTEXT"
        ? await assignPilotCommunicationContext({ actor, planId })
        : await verifyPilotMailingListPrivacy({ actor, planId });
    const summary = await getZohoPlanAutomationSummary(planId, {
      currentStaffRole: "ADMIN",
      includePermissionEvidenceReference: true
    });
    return NextResponse.json({ action: body.action, changed: result.changed, summary });
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
