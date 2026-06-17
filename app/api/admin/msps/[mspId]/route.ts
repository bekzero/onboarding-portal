import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { updateMsp } from "@/lib/msp-persistence";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      accessMode?: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      name?: string;
      primaryContactEmail?: string;
      slug?: string;
    };
    const { mspId } = await params;
    const msp = await updateMsp(mspId, body);
    return NextResponse.json({ msp });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
