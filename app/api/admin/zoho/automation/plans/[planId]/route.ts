import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoPlanAutomationSummary } from "@/lib/zoho-admin-center";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const { planId } = await context.params;
  const summary = await getZohoPlanAutomationSummary(planId);
  return summary ? NextResponse.json(summary) : NextResponse.json({ error: "Plan not found." }, { status: 404 });
}
