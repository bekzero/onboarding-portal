import { randomUUID } from "node:crypto";
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
import { validateEnrollmentSubscriptionAuthorization } from "@/lib/zoho-subscription-authorization";

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

  const requestId = randomUUID();
  function enrollmentError(code: string, error: string, status = 400) {
    console.warn("[msp-enrollment]", { code, requestId, status });
    return NextResponse.json({ code, error, requestId }, { status });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return enrollmentError("INVALID_ENROLLMENT_REQUEST", "Enter the MSP details and try again.");
  }

  try {
    const { zohoTestJ1Preparation, ...body } = payload as {
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
      zohoSubscriptionAuthorization?: {
        authorizationBasis?: string;
        confirmed?: boolean;
        evidenceReference?: string;
      };
      zohoTestJ1Preparation?: {
        confirmed?: boolean;
        productionJourneyReuseConfirmed?: boolean;
        reviewEvidenceReference?: string;
      };
    };

    if (zohoTestJ1Preparation?.confirmed || zohoTestJ1Preparation?.productionJourneyReuseConfirmed) {
      return enrollmentError(
        "LEGACY_TEST_J1_NOT_SUPPORTED",
        "Refresh this page and enroll the MSP again. Manage email activation from the Automated Emails panel after enrollment."
      );
    }

    if (body.zohoSubscriptionAuthorization?.confirmed) {
      const sensitiveAuthError = await getSensitiveAdminApiAuthError(request, "ADMIN");
      if (sensitiveAuthError) return sensitiveAuthError;
    }

    if (
      body.zohoContactPermission?.evidenceReference != null &&
      typeof body.zohoContactPermission.evidenceReference !== "string"
    ) {
      return enrollmentError("INVALID_PERMISSION_EVIDENCE", "Permission Evidence Reference must be text.");
    }
    const permission = validateEnrollmentContactPermission(body.zohoContactPermission);
    if (!permission.valid) {
      return enrollmentError(
        "PERMISSION_EVIDENCE_REQUIRED",
        "Permission Evidence Reference is required when Zoho permission is confirmed."
      );
    }
    const subscription = validateEnrollmentSubscriptionAuthorization(body.zohoSubscriptionAuthorization);
    if (!subscription.valid) {
      return enrollmentError("INVALID_SUBSCRIPTION_AUTHORIZATION", subscription.error);
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
      zohoSubscriptionAuthorization: {
        authorizationBasis: subscription.authorizationBasis,
        confirmed: subscription.confirmed,
        evidenceReference: subscription.evidenceReference
      }
    });
    return NextResponse.json({ msp: adminCase }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return enrollmentError("MSP_ALREADY_EXISTS", "An MSP or onboarding plan with this identifier already exists.", 409);
    }
    const validationCodes: Record<string, string> = {
      "MSP slug is required.": "MSP_SLUG_REQUIRED",
      "Customer name is required for a Customer Plan.": "CUSTOMER_NAME_REQUIRED",
      "Primary contact email is required.": "INVALID_PRIMARY_CONTACT_EMAIL",
      "Enter a valid primary contact email.": "INVALID_PRIMARY_CONTACT_EMAIL",
      "Enter a valid assigned sales engineer email.": "INVALID_ASSIGNED_SE_EMAIL",
      "Assigned Sales Engineer booking URL must be a valid HTTP or HTTPS URL.": "INVALID_ASSIGNED_SE_BOOKING_URL"
    };
    if (error instanceof Error && Object.hasOwn(validationCodes, error.message)) {
      return enrollmentError(validationCodes[error.message]!, error.message);
    }
    return enrollmentError("MSP_ENROLLMENT_FAILED", "Could not save the new MSP. Check the MSP list before trying again.", 500);
  }
}
