import { NextResponse } from "next/server";
import { getAdminApiAuthError, getSensitiveAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoDispatchConfiguration } from "@/lib/zoho-config";
import { dispatchZohoOutboxBatch, getZohoDispatcherSummary } from "@/lib/zoho-dispatcher";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  return NextResponse.json(await getZohoDispatcherSummary());
}

export async function POST(request: Request) {
  const authError = await getAdminApiAuthError("ADMIN");
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const config = getZohoDispatchConfiguration();
  if (config.mode !== "test") {
    return NextResponse.json({ error: "Manual dispatch is restricted to explicit test mode." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { confirmation?: unknown; maxEvents?: unknown } | null;
  if (body?.confirmation !== "DISPATCH ALLOWLISTED ZOHO TEST EVENTS") {
    return NextResponse.json({ error: "Explicit test dispatch confirmation is required." }, { status: 400 });
  }
  const requested = typeof body.maxEvents === "number" ? Math.trunc(body.maxEvents) : 1;
  return NextResponse.json(await dispatchZohoOutboxBatch({ maxEvents: Math.max(1, Math.min(10, requested)) }));
}
