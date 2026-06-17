import { NextRequest, NextResponse } from "next/server";
import {
  createOpaqueOidcValue,
  writeOidcStateSession
} from "@/lib/oidc-session";
import {
  buildAuthorizationUrl,
  findServerTenantOidcConfigByInput,
  getKzeroRedirectUri
} from "@/lib/server-tenant-registry";

function redirectToStart(request: NextRequest, error: string) {
  const targetUrl = new URL("/start", request.url);
  targetUrl.searchParams.set("error", error);
  return NextResponse.redirect(targetUrl);
}

export async function GET(request: NextRequest) {
  const lookupValue = request.nextUrl.searchParams.get("tenant")?.trim() || "";
  const tenantConfig = findServerTenantOidcConfigByInput(lookupValue);

  if (!lookupValue || !tenantConfig) {
    return redirectToStart(request, "not_found");
  }

  if (!tenantConfig.clientId || !process.env.AUTH_SECRET) {
    return redirectToStart(request, "oidc_not_configured");
  }

  const state = createOpaqueOidcValue();
  const nonce = createOpaqueOidcValue();
  const sessionWritten = await writeOidcStateSession({
    expiresAt: Date.now() + 10 * 60 * 1000,
    lookupValue,
    nonce,
    planId: tenantConfig.planId,
    state,
    tenantName: tenantConfig.tenantName
  });

  if (!sessionWritten) {
    return redirectToStart(request, "oidc_not_configured");
  }

  const authorizationUrl = new URL(buildAuthorizationUrl(tenantConfig));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", tenantConfig.clientId);
  authorizationUrl.searchParams.set("redirect_uri", getKzeroRedirectUri());
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);

  return NextResponse.redirect(authorizationUrl);
}
