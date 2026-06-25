import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { getAdminPortalAccessByMspId, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { writePortalSession } from "@/lib/oidc-session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const { mspId } = await params;
  const mspAccess = await getAdminPortalAccessByMspId(mspId).catch(() => null);

  if (!mspAccess?.planId) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const sessionWritten = await writePortalSession({
    planId: mspAccess.planId,
    tenantName: mspAccess.tenantName
  });

  if (!sessionWritten) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.redirect(new URL(`/portal/${mspAccess.planId}`, request.url));
}
