import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/auth";
import { completePortalTask, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string; taskId: string }> }
) {
  await requirePortalUser();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Server-side onboarding persistence is not configured." }, { status: 503 });
  }

  try {
    const { planId, taskId } = await params;
    const bundle = await completePortalTask(planId, taskId);

    if (!bundle) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the onboarding task.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
