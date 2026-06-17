import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { configureOidcForMsp, getOidcConfigForMsp } from "@/lib/msp-persistence";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const { mspId } = await params;
    const oidcConfig = await getOidcConfigForMsp(mspId);
    return NextResponse.json({ oidcConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load OIDC config.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      tenantRealm: string;
    };
    const { mspId } = await params;
    const oidcConfig = await configureOidcForMsp(mspId, body);
    return NextResponse.json({ oidcConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save OIDC config.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const PATCH = POST;
