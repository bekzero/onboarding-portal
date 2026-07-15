import { NextRequest, NextResponse } from "next/server";
import { findPortalLookupMatch, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { writePortalSession } from "@/lib/oidc-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const lookupResult = await findPortalLookupMatch(lookup).catch(() => ({ status: "not_found" } as const));

  if (lookupResult.status === "ambiguous") {
    return redirectToStart(request, "ambiguous");
  }

  if (lookupResult.status !== "found" || lookupResult.match.accessMode !== "temporary") {
    return redirectToStart(request, "not_found");
  }

  const sessionWritten = await writePortalSession({
    planId: lookupResult.match.planId,
    tenantName: lookupResult.match.tenantRealm ?? lookupResult.match.displayName
  });

  if (!sessionWritten) {
    return redirectToStart(request, "session_required");
  }

  return NextResponse.redirect(new URL(`/portal/${lookupResult.match.planId}`, request.url));
}
