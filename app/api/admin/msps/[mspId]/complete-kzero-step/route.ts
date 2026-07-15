import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { completeCurrentKzeroTaskForMsp } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const { mspId } = await params;
    const bundle = await completeCurrentKzeroTaskForMsp(mspId);

    if (!bundle) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the current KZero step.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
