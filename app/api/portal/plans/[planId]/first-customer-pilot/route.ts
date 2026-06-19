import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/auth";
import { isDatabasePersistenceConfigured, submitFirstCustomerPilot } from "@/lib/msp-persistence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  await requirePortalUser();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Server-side onboarding persistence is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as {
      adminContactEmail?: string;
      adminContactName?: string;
      customerAlias: string;
      estimatedUserCount?: number;
      notes?: string;
      targetRolloutTiming: string;
    };
    const { planId } = await params;
    const bundle = await submitFirstCustomerPilot(planId, body);

    if (!bundle) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the first customer pilot details.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
