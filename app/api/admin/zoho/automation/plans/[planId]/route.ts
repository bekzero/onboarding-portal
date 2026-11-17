import { NextResponse } from "next/server";
import { getAdminApiAuthError, getCurrentStaffIdentity } from "@/lib/admin-auth";
import { getZohoPlanAutomationSummary } from "@/lib/zoho-admin-center";

export const dynamic = "force-dynamic";

async function loadAuthorizedSummary(context: { params: Promise<{ planId: string }> }) {
  const { planId } = await context.params;
  const staffIdentity = await getCurrentStaffIdentity();
  return getZohoPlanAutomationSummary(planId, {
    currentStaffRole: staffIdentity?.role ?? null,
    includePermissionEvidenceReference: Boolean(staffIdentity)
  });
}

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const summary = await loadAuthorizedSummary(context);
  return summary ? NextResponse.json(summary) : NextResponse.json({ error: "Plan not found." }, { status: 404 });
}

export async function POST(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const summary = await loadAuthorizedSummary(context);
  if (!summary) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  return NextResponse.json({
    dryRun: true,
    evaluatedAt: new Date().toISOString(),
    enrollmentContactSync: summary.enrollmentContactSync
  });
}
