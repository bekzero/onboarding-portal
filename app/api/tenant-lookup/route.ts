import { NextRequest, NextResponse } from "next/server";
import { getMspByLookup, getOidcConfigForMsp, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { findTenantByInput } from "@/lib/tenant-routing";

export async function GET(request: NextRequest) {
  const lookup = request.nextUrl.searchParams.get("lookup")?.trim() || "";

  if (!lookup) {
    return NextResponse.json({ found: false }, { status: 400 });
  }

  if (isDatabasePersistenceConfigured()) {
    const msp = await getMspByLookup(lookup).catch(() => null);

    if (msp) {
      const oidcConfig = msp.accessMode === "oidc" ? await getOidcConfigForMsp(msp.id).catch(() => null) : null;
      return NextResponse.json({
        found: true,
        msp: {
          accessMode: msp.accessMode,
          name: msp.name,
          planId: `${msp.slug}-nfr`,
          slug: msp.slug,
          tenantRealm: oidcConfig?.tenantRealm
        }
      });
    }
  }

  const fallbackTenant = findTenantByInput(lookup);
  if (!fallbackTenant) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({
    found: true,
    msp: {
      accessMode: fallbackTenant.accessMode,
      name: fallbackTenant.displayName,
      planId: fallbackTenant.planId,
      slug: fallbackTenant.mspSlug,
      tenantRealm: fallbackTenant.tenantName
    }
  });
}
