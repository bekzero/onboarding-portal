import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { getAdminPortalAccessByMspId, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    const fallbackPlanId = request.nextUrl.searchParams.get("planId")?.trim();
    if (fallbackPlanId) {
      return NextResponse.redirect(new URL(`/portal/${fallbackPlanId}`, request.url));
    }

    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const { mspId } = await params;
  const requestedPlanId = request.nextUrl.searchParams.get("planId")?.trim() || null;
  const mspAccess = await getAdminPortalAccessByMspId(mspId, requestedPlanId).catch((error) => {
    console.error("Could not resolve admin portal access.", error);
    return null;
  });

  if (!mspAccess?.planId && requestedPlanId) {
    return NextResponse.redirect(new URL(`/portal/${requestedPlanId}`, request.url));
  }

  if (!mspAccess?.planId) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.redirect(new URL(`/portal/${mspAccess.planId}`, request.url));
}
