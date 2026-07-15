import { NextRequest, NextResponse } from "next/server";
import {
  findPortalLookupMatch,
  getOidcConfigForMsp,
  isDatabasePersistenceConfigured
} from "@/lib/msp-persistence";
import { findTenantByInput } from "@/lib/tenant-routing";

export async function GET(request: NextRequest) {
  const lookup = request.nextUrl.searchParams.get("lookup")?.trim() || "";

  if (!lookup) {
    return NextResponse.json({ found: false }, { status: 400 });
  }

  if (isDatabasePersistenceConfigured()) {
    const lookupResult = await findPortalLookupMatch(lookup).catch(() => ({ status: "not_found" } as const));

    if (lookupResult.status === "ambiguous") {
      return NextResponse.json(
        {
          ambiguous: true,
          found: false,
          matches: lookupResult.matches.map((match) => ({
            customerName: match.customerName,
            displayName: match.displayName,
            mspName: match.mspName,
            planId: match.planId,
            planType: match.planType
          }))
        },
        { status: 409 }
      );
    }

    if (lookupResult.status === "found") {
      const oidcConfig =
        lookupResult.match.accessMode === "oidc"
          ? await getOidcConfigForMsp(lookupResult.match.id).catch(() => null)
          : null;
      return NextResponse.json({
        found: true,
        msp: {
          accessMode: lookupResult.match.accessMode,
          customerName: lookupResult.match.customerName,
          destination: "portal",
          displayName: lookupResult.match.displayName,
          mspName: lookupResult.match.mspName,
          name: lookupResult.match.mspName,
          planId: lookupResult.match.planId,
          planType: lookupResult.match.planType,
          slug: lookupResult.match.slug,
          tenantRealm: oidcConfig?.tenantRealm
        }
      });
    }

    return NextResponse.json({ found: false }, { status: 404 });
  }

  const fallbackTenant = findTenantByInput(lookup);
  if (!fallbackTenant || fallbackTenant.status === "not_found") {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  if (fallbackTenant.status === "ambiguous") {
    return NextResponse.json(
      {
        ambiguous: true,
        found: false,
        matches: fallbackTenant.matches.map((match) => ({
          customerName: match.customerName,
          displayName: match.displayName,
          mspName: match.mspName,
          planId: match.planId,
          planType: match.planType
        }))
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    found: true,
    msp: {
      accessMode: fallbackTenant.match.accessMode,
      customerName: fallbackTenant.match.customerName,
      destination: "demo",
      displayName: fallbackTenant.match.displayName,
      mspName: fallbackTenant.match.mspName,
      name: fallbackTenant.match.mspName,
      planId: fallbackTenant.match.planId,
      planType: fallbackTenant.match.planType,
      slug: fallbackTenant.match.mspSlug,
      tenantRealm: fallbackTenant.match.tenantName
    }
  });
}
