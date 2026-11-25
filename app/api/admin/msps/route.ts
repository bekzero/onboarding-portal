import { NextRequest, NextResponse } from "next/server";
import {
  getAdminApiAuthError,
  getAdminAuditActor,
  getCurrentStaffIdentity,
  getSensitiveAdminApiAuthError
} from "@/lib/admin-auth";
import { createMsp, getAdminDashboardCases, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { formatStaffAuditActor } from "@/lib/staff-auth";
import { validateEnrollmentContactPermission } from "@/lib/zoho-enrollment-sync-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  try {
    return NextResponse.json({
      msps: await getAdminDashboardCases()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load MSP records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await getAdminApiAuthError("SALES_ENGINEER");
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      accessMode: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      assignedSeBookingUrl?: string;
      assignedSeEmail?: string;
      customerName?: string;
      enrollmentDate?: string;
      isGmmPartner?: boolean;
      name: string;
      planType?: "nfr" | "customer";
      primaryContactEmail: string;
      primaryContactFirstName?: string;
      primaryContactLastName?: string;
      slug?: string;
      zohoContactPermission?: { confirmed?: boolean; evidenceReference?: string };
      zohoTestJ1Preparation?: {
        confirmed?: boolean;
        productionJourneyReuseConfirmed?: boolean;
        reviewEvidenceReference?: string;
      };
    };

    if (body.zohoTestJ1Preparation?.confirmed) {
      const sensitiveAuthError = await getSensitiveAdminApiAuthError(request, "ADMIN");
      if (sensitiveAuthError) return sensitiveAuthError;
    }

    const permission = validateEnrollmentContactPermission(body.zohoContactPermission);
    if (!permission.valid) {
      return NextResponse.json(
        { error: "Permission Evidence Reference is required when Zoho permission is confirmed." },
        { status: 400 }
      );
    }

    const staffIdentity = await getCurrentStaffIdentity();
    const adminCase = await createMsp({
      ...body,
      zohoAuditActor: staffIdentity ? formatStaffAuditActor(staffIdentity) : getAdminAuditActor(),
      zohoAuditActorAttributable: Boolean(staffIdentity),
      zohoContactPermission: {
        confirmed: permission.confirmed,
        evidenceReference: permission.evidenceReference
      },
      zohoTestJ1Preparation: {
        confirmed: body.zohoTestJ1Preparation?.confirmed === true,
        productionJourneyReuseConfirmed:
          body.zohoTestJ1Preparation?.productionJourneyReuseConfirmed === true,
        reviewEvidenceReference: body.zohoTestJ1Preparation?.reviewEvidenceReference
      }
    });
    return NextResponse.json({ msp: adminCase }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
