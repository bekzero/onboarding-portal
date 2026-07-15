import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/auth";
import { isDatabasePersistenceConfigured, submitPortalSaasApp } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      loginUrl?: string;
      name: string;
      notes?: string;
      priority?: string;
    };
    const { planId } = await params;
    const bundle = await submitPortalSaasApp(planId, body);

    if (!bundle) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the SaaS application.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
