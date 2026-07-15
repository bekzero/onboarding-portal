import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { getOnboardingDocumentForDownload } from "@/lib/onboarding-documents";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string; planId: string }> }
) {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "Document could not be opened." }, { status: 503 });
  }

  try {
    const { documentId, planId } = await params;
    const result = await getOnboardingDocumentForDownload(planId, documentId);

    if (result.status === "plan_not_found" || result.status === "document_not_found") {
      return NextResponse.json({ error: "Document could not be opened." }, { status: 404 });
    }

    return new NextResponse(result.stream, {
      headers: {
        "Content-Disposition": `inline; filename="${encodeURIComponent(result.document.fileName)}"`,
        "Content-Type": result.document.mimeType?.trim() || result.blob.contentType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      },
      status: 200
    });
  } catch (error) {
    console.error("Could not stream admin onboarding document.", error);
    return NextResponse.json({ error: "Document could not be opened." }, { status: 500 });
  }
}
