import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { deleteMsp, updateMsp } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      accessMode?: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      customerName?: string;
      currentStage?: string;
      enrollmentDate?: string;
      isGmmPartner?: boolean;
      lastActivity?: string;
      name?: string;
      planType?: "nfr" | "customer";
      primaryContactEmail?: string;
      progress?: number;
      slug?: string;
      status?: string;
      submittedSaasAppCount?: number;
      tenantRealm?: string;
    };
    const { mspId } = await params;
    const adminCase = await updateMsp(mspId, body);
    return NextResponse.json({ msp: adminCase });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const { mspId } = await params;
    await deleteMsp(mspId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
