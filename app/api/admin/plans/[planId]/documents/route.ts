import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { listOnboardingDocuments } from "@/lib/onboarding-documents";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Server-side onboarding persistence is not configured." }, { status: 503 });
  }

  try {
    const { planId } = await params;
    const documents = await listOnboardingDocuments(planId);

    if (!documents) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Could not load admin onboarding documents.", error);
    return NextResponse.json({ error: "Documents could not be loaded right now." }, { status: 500 });
  }
}
