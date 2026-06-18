import { NextRequest, NextResponse } from "next/server";
import { getMspByLookup, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { writePortalSession } from "@/lib/oidc-session";

function redirectToStart(request: NextRequest, error: string) {
  const targetUrl = new URL("/start", request.url);
  targetUrl.searchParams.set("error", error);
  return NextResponse.redirect(targetUrl);
}

export async function GET(request: NextRequest) {
  if (!isDatabasePersistenceConfigured()) {
    return redirectToStart(request, "not_found");
  }

  const lookup = request.nextUrl.searchParams.get("lookup")?.trim() || "";
  if (!lookup) {
    return redirectToStart(request, "not_found");
  }

  const msp = await getMspByLookup(lookup).catch(() => null);

  if (!msp || msp.accessMode !== "temporary") {
    return redirectToStart(request, "not_found");
  }

  const planId = `${msp.slug}-nfr`;
  const sessionWritten = await writePortalSession({
    planId,
    tenantName: msp.tenantRealm ?? msp.name
  });

  if (!sessionWritten) {
    return redirectToStart(request, "session_required");
  }

  return NextResponse.redirect(new URL(`/portal/${planId}`, request.url));
}
