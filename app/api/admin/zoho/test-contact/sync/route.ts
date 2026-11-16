import { NextRequest, NextResponse } from "next/server";
import {
  getAdminApiAuthError,
  getSensitiveAdminApiAuthError,
  getSensitiveAdminAuditActor
} from "@/lib/admin-auth";
import { syncZohoTestContact } from "@/lib/zoho-test-contact";
import { zohoAdminErrorResponse } from "@/lib/zoho-route-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("ADMIN");
  if (authError) return authError;
  const identityError = await getSensitiveAdminApiAuthError(request);
  if (identityError) return identityError;
  const actor = await getSensitiveAdminAuditActor();
  if (!actor) return NextResponse.json({ error: "Authenticated staff ADMIN identity is required." }, { status: 403 });
  try {
    const body = (await request.json()) as { confirmation?: unknown; email?: unknown; requestId?: unknown };
    return NextResponse.json(await syncZohoTestContact({
      actor,
      confirmation: body.confirmation,
      email: body.email,
      requestId: body.requestId
    }));
  } catch (error) {
    return zohoAdminErrorResponse(error);
  }
}
