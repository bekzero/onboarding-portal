import { NextRequest, NextResponse } from "next/server";
import {
  clearOidcStateSession,
  readOidcStateSession,
  writePortalOidcSession
} from "@/lib/oidc-session";
import {
  buildTokenUrl,
  buildUserInfoUrl,
  findServerTenantOidcConfigByPlanId,
  getKzeroRedirectUri
} from "@/lib/server-tenant-registry";

function redirectToStart(request: NextRequest, error: string) {
  const targetUrl = new URL("/start", request.url);
  targetUrl.searchParams.set("error", error);
  return NextResponse.redirect(targetUrl);
}

function decodeJwtPayload(token?: string) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oidcError = request.nextUrl.searchParams.get("error");

  if (oidcError) {
    await clearOidcStateSession();
    return redirectToStart(request, "signin_failed");
  }

  const stateSession = await readOidcStateSession();

  if (!code || !state || !stateSession || state !== stateSession.state) {
    await clearOidcStateSession();
    return redirectToStart(request, "session_required");
  }

  const tenantConfig = await findServerTenantOidcConfigByPlanId(stateSession.planId);

  if (!tenantConfig?.clientId || !tenantConfig.clientSecret) {
    await clearOidcStateSession();
    return redirectToStart(request, "oidc_not_configured");
  }

  const tokenResponse = await fetch(buildTokenUrl(tenantConfig), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: tenantConfig.clientId,
      client_secret: tenantConfig.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: getKzeroRedirectUri()
    }).toString(),
    cache: "no-store"
  }).catch(() => null);

  if (!tokenResponse?.ok) {
    await clearOidcStateSession();
    return redirectToStart(request, "signin_failed");
  }

  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    id_token?: string;
  };

  const idTokenPayload = decodeJwtPayload(tokenPayload.id_token);
  const nonceClaim = typeof idTokenPayload?.nonce === "string" ? idTokenPayload.nonce : null;

  if (!nonceClaim || nonceClaim !== stateSession.nonce) {
    await clearOidcStateSession();
    return redirectToStart(request, "signin_failed");
  }

  let email: string | undefined;

  if (tokenPayload.access_token) {
    const userInfoResponse = await fetch(buildUserInfoUrl(tenantConfig), {
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`
      },
      cache: "no-store"
    }).catch(() => null);

    if (userInfoResponse?.ok) {
      const userInfoPayload = (await userInfoResponse.json()) as { email?: unknown };
      email = typeof userInfoPayload.email === "string" ? userInfoPayload.email : undefined;
    }
  }

  const sessionWritten = await writePortalOidcSession({
    email,
    planId: stateSession.planId,
    tenantName: stateSession.tenantName
  });

  await clearOidcStateSession();

  if (!sessionWritten) {
    return redirectToStart(request, "oidc_not_configured");
  }

  return NextResponse.redirect(new URL("/portal/resolve", request.url));
}
