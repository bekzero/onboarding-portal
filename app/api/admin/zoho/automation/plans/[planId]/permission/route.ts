import { NextResponse } from "next/server";
import { getAdminApiAuthError, getAdminAuditActor, getCurrentStaffIdentity } from "@/lib/admin-auth";
import { formatStaffAuditActor, isTrustedSameOriginRequest } from "@/lib/staff-auth";
import { recordExistingMspContactPermission } from "@/lib/zoho-enrollment-sync";
import { validateEnrollmentContactPermission } from "@/lib/zoho-enrollment-sync-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;
  if (!isTrustedSameOriginRequest(request)) {
    return NextResponse.json({ error: "The request origin could not be verified." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { confirmed?: boolean; evidenceReference?: string };
    const permission = validateEnrollmentContactPermission(body);
    if (!permission.confirmed || !permission.valid) {
      return NextResponse.json(
        { error: "Permission confirmation and an evidence reference are required." },
        { status: 400 }
      );
    }
    const { planId } = await context.params;
    const staffIdentity = await getCurrentStaffIdentity();
    const result = await recordExistingMspContactPermission({
      actor: staffIdentity ? formatStaffAuditActor(staffIdentity) : getAdminAuditActor(),
      evidenceReference: permission.evidenceReference,
      permissionConfirmed: true,
      planId
    });
    return NextResponse.json({
      created: result.created,
      individuallyAttributable: Boolean(staffIdentity),
      permissionRecorded: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record Zoho permission evidence.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
