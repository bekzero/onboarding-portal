import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/auth";
import { listOnboardingDocuments, uploadOnboardingDocuments } from "@/lib/onboarding-documents";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  await requirePortalUser();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Server-side onboarding persistence is not configured." }, { status: 503 });
  }

  const { planId } = await params;
  const documents = await listOnboardingDocuments(planId);

  if (!documents) {
    return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
  }

  return NextResponse.json({ documents });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const sessionUser = await requirePortalUser();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Server-side onboarding persistence is not configured." }, { status: 503 });
  }

  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => typeof File !== "undefined" && value instanceof File);
    const { planId } = await params;
    const documents = await uploadOnboardingDocuments({
      files,
      planId,
      uploadedByName: sessionUser.name ?? sessionUser.email ?? null
    });

    if (!documents) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ documents }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload the selected documents.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
